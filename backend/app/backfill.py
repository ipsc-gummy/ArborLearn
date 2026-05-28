from __future__ import annotations

import json
import re
import sqlite3
from typing import Any, Literal

from fastapi import HTTPException

from .db import get_node_for_user, get_parent_chain, now_iso, uid
from .effective_context import content_hash, public_patch_view


EDIT_TYPES = {"correct", "expand", "compress", "reframe"}
ACTIVE_PATCH_STATUSES = {"draft", "applied"}
MAX_REPLACEMENT_CHARS = 20000
UNLIMITED_REPLACEMENT_EDIT_TYPES = {"expand", "reframe"}
CONTEXT_SLICE_CHARS = 80
EXPAND_CONTEXT_KEYWORDS = (
    "跨段",
    "多段",
    "前后文",
    "上下文",
    "相邻段",
    "整段",
    "整个段落",
    "连贯",
    "通顺",
    "重构",
)
NEXT_PARAGRAPH_CONNECTORS = (
    "因此",
    "所以",
    "但",
    "但是",
    "不过",
    "同时",
    "此外",
    "这",
    "上述",
    "前者",
    "后者",
)
CURRENT_PARAGRAPH_CONNECTORS = (
    "因此",
    "所以",
    "但",
    "但是",
    "不过",
    "同时",
    "此外",
    "这",
    "上述",
)
INLINE_MARKDOWN_WRAPPERS = (
    ("**", "**"),
    ("__", "__"),
    ("~~", "~~"),
    ("`", "`"),
    ("*", "*"),
    ("_", "_"),
)


def line_spans(content: str) -> list[tuple[int, int]]:
    if not content:
        return [(0, 0)]
    spans: list[tuple[int, int]] = []
    start = 0
    for match in re.finditer(r"\n", content):
        end = match.end()
        spans.append((start, end))
        start = end
    if start < len(content):
        spans.append((start, len(content)))
    return spans


def line_index_at(spans: list[tuple[int, int]], position: int) -> int:
    for index, (start, end) in enumerate(spans):
        if start <= position < end:
            return index
    return max(0, len(spans) - 1)


def line_text(content: str, span: tuple[int, int]) -> str:
    return content[span[0] : span[1]].rstrip("\n")


def is_blank_line(content: str, span: tuple[int, int]) -> bool:
    return not line_text(content, span).strip()


def paragraph_ranges(content: str) -> list[tuple[int, int]]:
    spans = line_spans(content)
    ranges: list[tuple[int, int]] = []
    start: int | None = None
    end: int | None = None
    for span in spans:
        if is_blank_line(content, span):
            if start is not None and end is not None:
                ranges.append((start, end))
                start = None
                end = None
            continue
        if start is None:
            start = span[0]
        end = span[1]
    if start is not None and end is not None:
        ranges.append((start, end))
    return ranges


def range_contains(outer: tuple[int, int], start: int, end: int) -> bool:
    return outer[0] <= start and end <= outer[1]


def current_paragraph_index(paragraphs: list[tuple[int, int]], start: int, end: int) -> int | None:
    for index, paragraph in enumerate(paragraphs):
        if range_contains(paragraph, start, end):
            return index
    return None


def expand_to_fenced_code_block(content: str, start: int, end: int) -> tuple[int, int] | None:
    spans = line_spans(content)
    start_line = line_index_at(spans, start)
    end_line = line_index_at(spans, max(start, end - 1))
    fence_lines = [
        index
        for index, span in enumerate(spans)
        if re.match(r"^\s*```", line_text(content, span))
    ]
    for fence_index in range(0, len(fence_lines), 2):
        opening = fence_lines[fence_index]
        closing = fence_lines[fence_index + 1] if fence_index + 1 < len(fence_lines) else opening
        if opening <= start_line and end_line <= closing:
            return spans[opening][0], spans[closing][1]
    return None


def expand_to_line_block(content: str, start: int, end: int) -> tuple[int, int] | None:
    spans = line_spans(content)
    start_line = line_index_at(spans, start)
    end_line = line_index_at(spans, max(start, end - 1))

    def block_kind(index: int) -> str | None:
        text = line_text(content, spans[index])
        if re.match(r"^\s*(?:[-*+]\s+|\d+[.)]\s+)", text):
            return "list"
        if re.match(r"^\s*>", text):
            return "quote"
        if "|" in text:
            return "table"
        return None

    kinds = {block_kind(index) for index in range(start_line, end_line + 1)}
    kinds.discard(None)
    if not kinds:
        return None
    kind = sorted(kinds)[0]
    block_start = start_line
    block_end = end_line
    while block_start > 0 and not is_blank_line(content, spans[block_start - 1]):
        if block_kind(block_start - 1) != kind:
            break
        block_start -= 1
    while block_end + 1 < len(spans) and not is_blank_line(content, spans[block_end + 1]):
        if block_kind(block_end + 1) != kind:
            break
        block_end += 1
    return spans[block_start][0], spans[block_end][1]


def expand_to_inline_markdown_wrapper(content: str, start: int, end: int) -> tuple[int, int, str | None]:
    expanded_start = start
    expanded_end = end
    matched: list[str] = []
    changed = True
    while changed:
        changed = False
        for opener, closer in INLINE_MARKDOWN_WRAPPERS:
            if expanded_start >= len(opener) and content[expanded_start - len(opener) : expanded_start] == opener:
                if expanded_end + len(closer) <= len(content) and content[expanded_end : expanded_end + len(closer)] == closer:
                    expanded_start -= len(opener)
                    expanded_end += len(closer)
                    matched.append(opener)
                    changed = True
                    break
    if expanded_start == start and expanded_end == end:
        return start, end, None
    markers = "、".join(dict.fromkeys(matched))
    return expanded_start, expanded_end, f"锚点紧贴 Markdown 行内格式标记（{markers}），已自动纳入完整标记以避免回填后格式错乱。"


def should_expand_across_paragraphs(edit_type: str, user_instruction: str | None) -> bool:
    instruction = user_instruction or ""
    return edit_type == "reframe" or any(keyword in instruction for keyword in EXPAND_CONTEXT_KEYWORDS)


def decide_target_range(
    content: str,
    anchor_start: int,
    anchor_end: int,
    edit_type: str,
    user_instruction: str | None = None,
) -> tuple[int, int, str | None]:
    inline_start, inline_end, inline_reason = expand_to_inline_markdown_wrapper(content, anchor_start, anchor_end)
    if inline_reason:
        return inline_start, inline_end, inline_reason

    fenced = expand_to_fenced_code_block(content, anchor_start, anchor_end)
    if fenced:
        return fenced[0], fenced[1], "锚点位于 Markdown 代码块内，已扩大到完整代码块以避免破坏围栏格式。"

    line_block = expand_to_line_block(content, anchor_start, anchor_end)
    if line_block:
        return line_block[0], line_block[1], "锚点位于 Markdown 列表、引用或表格中，已扩大到完整结构块以保持格式闭合。"

    paragraphs = paragraph_ranges(content)
    paragraph_index = current_paragraph_index(paragraphs, anchor_start, anchor_end)
    if paragraph_index is None:
        return anchor_start, anchor_end, None

    expand_start = paragraphs[paragraph_index][0]
    expand_end = paragraphs[paragraph_index][1]
    reasons: list[str] = []
    current_text = content[expand_start:expand_end].strip()
    if should_expand_across_paragraphs(edit_type, user_instruction):
        reasons.append("用户意图或回填类型需要在完整段落层面保持论证连贯。")
        if paragraph_index > 0 and any(current_text.startswith(prefix) for prefix in CURRENT_PARAGRAPH_CONNECTORS):
            expand_start = paragraphs[paragraph_index - 1][0]
            reasons.append("当前段落依赖上一段的承接关系，已纳入上一段。")
        if paragraph_index + 1 < len(paragraphs):
            next_text = content[paragraphs[paragraph_index + 1][0] : paragraphs[paragraph_index + 1][1]].strip()
            if any(next_text.startswith(prefix) for prefix in NEXT_PARAGRAPH_CONNECTORS) or "前后文" in (user_instruction or "") or "上下文" in (user_instruction or "") or "跨段" in (user_instruction or "") or "多段" in (user_instruction or ""):
                expand_end = paragraphs[paragraph_index + 1][1]
                reasons.append("下一段与锚点段存在承接关系，已纳入下一段。")
        return expand_start, expand_end, " ".join(reasons) or "已扩大到完整段落范围。"

    return anchor_start, anchor_end, None


def parse_source_metadata(raw: str | None) -> dict | None:
    if not raw:
        return None
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, dict) else None


def ensure_int(value: Any, field_name: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise HTTPException(status_code=400, detail=f"{field_name} must be an integer")
    return value


def message_for_user(conn: sqlite3.Connection, message_id: str, user_id: str) -> sqlite3.Row | None:
    return conn.execute(
        """
        SELECT messages.id, messages.node_id, messages.role, messages.content, messages.created_at,
               nodes.notebook_id
        FROM messages
        JOIN nodes ON nodes.id = messages.node_id
        JOIN notebooks ON notebooks.id = nodes.notebook_id
        WHERE messages.id = ? AND notebooks.owner_user_id = ?
        """,
        (message_id, user_id),
    ).fetchone()


def validate_raw_range(content: str, start: int, end: int, field_name: str) -> str:
    if start < 0 or end < start or end > len(content):
        raise HTTPException(status_code=400, detail=f"{field_name} is outside the target message")
    return content[start:end]


def validate_target_range_contains_anchor(
    content: str,
    target_start: int,
    target_end: int,
    anchor_start: int,
    anchor_end: int,
) -> str:
    if not isinstance(target_start, int) or isinstance(target_start, bool):
        raise HTTPException(status_code=400, detail="targetRangeStart must be an integer")
    if not isinstance(target_end, int) or isinstance(target_end, bool):
        raise HTTPException(status_code=400, detail="targetRangeEnd must be an integer")
    original_text = validate_raw_range(content, target_start, target_end, "targetRange")
    if not (target_start <= anchor_start and anchor_end <= target_end):
        raise HTTPException(status_code=400, detail="targetRange must contain anchorRange")
    return original_text


def _unique_index(content: str, needle: str) -> int | None:
    if not needle:
        return None
    first = content.find(needle)
    if first < 0 or content.find(needle, first + max(len(needle), 1)) >= 0:
        return None
    return first


def resolve_anchor_range(content: str, metadata: dict, field_name: str = "anchorRange") -> tuple[int, int]:
    anchor_text = str(metadata.get("anchorText") or "")
    if not anchor_text:
        raise HTTPException(status_code=400, detail="anchorText cannot be empty")

    start = ensure_int(metadata.get("anchorRangeStart"), "anchorRangeStart")
    end = ensure_int(metadata.get("anchorRangeEnd"), "anchorRangeEnd")
    prefix = str(metadata.get("anchorPrefix") or "")
    suffix = str(metadata.get("anchorSuffix") or "")

    if 0 <= start <= end <= len(content) and content[start:end] == anchor_text:
        prefix_ok = not prefix or content[max(0, start - len(prefix)) : start] == prefix
        suffix_ok = not suffix or content[end : end + len(suffix)] == suffix
        if prefix_ok and suffix_ok:
            return start, end

    context_needle = f"{prefix}{anchor_text}{suffix}"
    context_start = _unique_index(content, context_needle)
    if context_start is not None:
        resolved_start = context_start + len(prefix)
        return resolved_start, resolved_start + len(anchor_text)

    text_start = _unique_index(content, anchor_text)
    if text_start is not None:
        return text_start, text_start + len(anchor_text)

    raise HTTPException(status_code=409, detail=f"{field_name} cannot be mapped exactly to target message")


def validate_source_metadata(conn: sqlite3.Connection, user_id: str, parent_id: str, metadata: dict) -> dict:
    if metadata.get("type") != "backfill_anchor":
        raise HTTPException(status_code=400, detail="Unsupported source metadata type")
    if metadata.get("coordinateSpace") != "raw_markdown":
        raise HTTPException(status_code=400, detail="Backfill source must use raw_markdown coordinates")
    if metadata.get("selectorStrategy") != "dom_to_raw_exact":
        raise HTTPException(status_code=400, detail="Selection cannot be mapped exactly to raw Markdown")

    target_message_id = str(metadata.get("targetMessageId") or "")
    target_message = message_for_user(conn, target_message_id, user_id)
    if not target_message:
        raise HTTPException(status_code=404, detail="Target message not found")
    if target_message["node_id"] != parent_id:
        raise HTTPException(status_code=400, detail="Target message must belong to the source parent node")

    expected_hash = metadata.get("baseMessageContentHash")
    if expected_hash != content_hash(target_message["content"]):
        raise HTTPException(status_code=409, detail="Target message version has changed")

    anchor_start, anchor_end = resolve_anchor_range(target_message["content"], metadata)
    anchor_text = target_message["content"][anchor_start:anchor_end]
    metadata["parentNodeId"] = parent_id
    metadata["targetMessageRole"] = target_message["role"]
    metadata["targetMessageCreatedAt"] = target_message["created_at"]
    metadata["baseContentLength"] = len(target_message["content"])
    metadata["anchorRangeStart"] = anchor_start
    metadata["anchorRangeEnd"] = anchor_end
    metadata["anchorText"] = anchor_text
    metadata["anchorPrefix"] = target_message["content"][max(0, anchor_start - CONTEXT_SLICE_CHARS) : anchor_start]
    metadata["anchorSuffix"] = target_message["content"][anchor_end : anchor_end + CONTEXT_SLICE_CHARS]
    return metadata


def normalize_source_metadata_for_storage(conn: sqlite3.Connection, user_id: str, parent_id: str, metadata: dict | None) -> str | None:
    if metadata is None:
        return None
    validated = validate_source_metadata(conn, user_id, parent_id, dict(metadata))
    return json.dumps(validated, ensure_ascii=False)


def active_patch_overlap(
    conn: sqlite3.Connection,
    target_message_id: str,
    start: int,
    end: int,
    exclude_patch_id: str | None = None,
    exclude_source_child_node_id: str | None = None,
) -> sqlite3.Row | None:
    rows = conn.execute(
        """
        SELECT id, source_child_node_id, target_range_start, target_range_end,
               anchor_text, original_text, replacement_text, edit_type
        FROM conversation_patches
        WHERE target_message_id = ?
          AND status IN ('draft', 'applied')
          AND (? IS NULL OR id != ?)
          AND (? IS NULL OR COALESCE(source_child_node_id, '') != ?)
        """,
        (
            target_message_id,
            exclude_patch_id,
            exclude_patch_id,
            exclude_source_child_node_id,
            exclude_source_child_node_id or "",
        ),
    ).fetchall()
    for row in rows:
        if start < row["target_range_end"] and row["target_range_start"] < end:
            return row
    return None


def archive_active_patches_for_source(
    conn: sqlite3.Connection,
    user_id: str,
    source_child_node_id: str,
    target_message_id: str,
    reason: str = "source_patch_replaced",
) -> list[str]:
    rows = conn.execute(
        """
        SELECT id
        FROM conversation_patches
        WHERE user_id = ?
          AND source_child_node_id = ?
          AND target_message_id = ?
          AND status IN ('draft', 'applied')
        """,
        (user_id, source_child_node_id, target_message_id),
    ).fetchall()
    patch_ids = [row["id"] for row in rows]
    if not patch_ids:
        return []
    placeholders = ",".join("?" for _ in patch_ids)
    ts = now_iso()
    conn.execute(
        f"""
        UPDATE conversation_patches
        SET status = 'archived',
            archive_reason = ?,
            archived_at = ?,
            updated_at = ?
        WHERE id IN ({placeholders})
        """,
        (reason, ts, ts, *patch_ids),
    )
    return patch_ids


def source_node_for_user(conn: sqlite3.Connection, user_id: str, node_id: str) -> sqlite3.Row | None:
    return conn.execute(
        """
        SELECT nodes.id, nodes.parent_id, nodes.notebook_id, nodes.source_metadata_json
        FROM nodes
        JOIN notebooks ON notebooks.id = nodes.notebook_id
        WHERE nodes.id = ? AND notebooks.owner_user_id = ?
        """,
        (node_id, user_id),
    ).fetchone()


def mark_summary_chain_stale(conn: sqlite3.Connection, node_id: str) -> None:
    chain = get_parent_chain(conn, node_id)
    ids = [row["id"] for row in chain]
    if not ids:
        return
    placeholders = ",".join("?" for _ in ids)
    conn.execute(
        f"UPDATE nodes SET summary_stale = 1, updated_at = ? WHERE id IN ({placeholders})",
        (now_iso(), *ids),
    )


def create_and_apply_patch(
    conn: sqlite3.Connection,
    user_id: str,
    *,
    source_child_node_id: str,
    target_message_id: str,
    edit_type: str,
    target_range_start: int,
    target_range_end: int,
    replacement_text: str,
) -> dict:
    if edit_type not in EDIT_TYPES:
        raise HTTPException(status_code=400, detail="Unsupported editType")
    replacement_text = replacement_text.strip("\r\n")
    if not replacement_text.strip():
        raise HTTPException(status_code=400, detail="replacementText cannot be empty")
    if edit_type not in UNLIMITED_REPLACEMENT_EDIT_TYPES and len(replacement_text) > MAX_REPLACEMENT_CHARS:
        raise HTTPException(status_code=400, detail="replacementText is too long")

    source_node = source_node_for_user(conn, user_id, source_child_node_id)
    if not source_node:
        raise HTTPException(status_code=404, detail="Source child node not found")
    source_metadata = parse_source_metadata(source_node["source_metadata_json"])
    if not source_metadata:
        raise HTTPException(status_code=400, detail="Source child node does not contain backfill metadata")
    if source_metadata.get("targetMessageId") != target_message_id:
        raise HTTPException(status_code=400, detail="Target message does not match source metadata")

    target_message = message_for_user(conn, target_message_id, user_id)
    if not target_message:
        raise HTTPException(status_code=404, detail="Target message not found")
    parent_node_id = str(source_metadata.get("parentNodeId") or target_message["node_id"])
    if target_message["node_id"] != parent_node_id:
        raise HTTPException(status_code=400, detail="Target message no longer belongs to the original parent node")
    if source_metadata.get("coordinateSpace") != "raw_markdown":
        raise HTTPException(status_code=400, detail="Only raw_markdown patches are supported")
    if source_metadata.get("baseMessageContentHash") != content_hash(target_message["content"]):
        raise HTTPException(status_code=409, detail="Target message version has changed")

    anchor_start, anchor_end = resolve_anchor_range(target_message["content"], source_metadata)
    anchor_text = target_message["content"][anchor_start:anchor_end]
    fallback_start, fallback_end, _ = expand_to_inline_markdown_wrapper(target_message["content"], anchor_start, anchor_end)
    if target_range_start == anchor_start and target_range_end == anchor_end:
        target_range_start, target_range_end = fallback_start, fallback_end

    original_text = validate_target_range_contains_anchor(
        target_message["content"],
        target_range_start,
        target_range_end,
        anchor_start,
        anchor_end,
    )
    if not original_text.strip():
        raise HTTPException(status_code=400, detail="targetRange cannot be empty")
    conflict = active_patch_overlap(
        conn,
        target_message_id,
        target_range_start,
        target_range_end,
        exclude_source_child_node_id=source_child_node_id,
    )
    if conflict:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "BACKFILL_RANGE_OVERLAP",
                "message": "该选区与另一个子对话的已生效回填范围重叠。请先撤回冲突回填，或重新选择不重叠的范围。",
                "conflictPatch": {
                    "id": conflict["id"],
                    "sourceChildNodeId": conflict["source_child_node_id"],
                    "targetRangeStart": conflict["target_range_start"],
                    "targetRangeEnd": conflict["target_range_end"],
                    "anchorText": conflict["anchor_text"],
                    "originalText": conflict["original_text"],
                    "replacementText": conflict["replacement_text"],
                    "editType": conflict["edit_type"],
                },
            },
        )
    archive_active_patches_for_source(conn, user_id, source_child_node_id, target_message_id)

    ts = now_iso()
    patch_id = uid("patch")
    source_snapshot = {
        "sourceChildNodeId": source_child_node_id,
        "sourceNodeExistsAtApply": True,
        "sourceMetadata": source_metadata,
    }
    conn.execute(
        """
        INSERT INTO conversation_patches(
          id, user_id, parent_node_id, source_child_node_id, source_snapshot_json,
          target_message_id, target_message_role, target_message_created_at,
          base_message_content_hash, base_content_length, coordinate_space, selector_strategy,
          anchor_range_start, anchor_range_end, target_range_start, target_range_end,
          anchor_text, anchor_prefix, anchor_suffix, original_text, replacement_text,
          status, edit_type, mapping_status, conflict_patch_id, archive_reason,
          created_at, updated_at, applied_at, archived_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'raw_markdown', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                'applied', ?, 'exact', NULL, NULL, ?, ?, ?, NULL)
        """,
        (
            patch_id,
            user_id,
            parent_node_id,
            source_child_node_id,
            json.dumps(source_snapshot, ensure_ascii=False),
            target_message_id,
            target_message["role"],
            target_message["created_at"],
            content_hash(target_message["content"]),
            len(target_message["content"]),
            source_metadata.get("selectorStrategy") or "dom_to_raw_exact",
            anchor_start,
            anchor_end,
            target_range_start,
            target_range_end,
            anchor_text,
            source_metadata.get("anchorPrefix") or "",
            source_metadata.get("anchorSuffix") or "",
            original_text,
            replacement_text,
            edit_type,
            ts,
            ts,
            ts,
        ),
    )
    mark_summary_chain_stale(conn, target_message["node_id"])
    row = conn.execute("SELECT * FROM conversation_patches WHERE id = ?", (patch_id,)).fetchone()
    return public_patch_view(row)


def archive_patch(conn: sqlite3.Connection, user_id: str, patch_id: str, reason: str = "user_reverted") -> dict:
    row = conn.execute(
        "SELECT * FROM conversation_patches WHERE id = ? AND user_id = ?",
        (patch_id, user_id),
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Patch not found")
    ts = now_iso()
    conn.execute(
        """
        UPDATE conversation_patches
        SET status = 'archived', archive_reason = ?, archived_at = ?, updated_at = ?
        WHERE id = ? AND user_id = ?
        """,
        (reason, ts, ts, patch_id, user_id),
    )
    updated = conn.execute("SELECT * FROM conversation_patches WHERE id = ?", (patch_id,)).fetchone()
    return public_patch_view(updated)


def archive_patches_for_message(
    conn: sqlite3.Connection,
    user_id: str,
    message_id: str,
    reason: str = "target_message_regenerated",
) -> int:
    ts = now_iso()
    cursor = conn.execute(
        """
        UPDATE conversation_patches
        SET status = 'archived',
            archive_reason = ?,
            archived_at = ?,
            updated_at = ?
        WHERE user_id = ?
          AND target_message_id = ?
          AND status IN ('draft', 'applied')
        """,
        (reason, ts, ts, user_id, message_id),
    )
    return cursor.rowcount


def list_message_patches(conn: sqlite3.Connection, user_id: str, message_id: str) -> list[dict]:
    message = message_for_user(conn, message_id, user_id)
    if not message:
        raise HTTPException(status_code=404, detail="Message not found")
    rows = conn.execute(
        """
        SELECT *
        FROM conversation_patches
        WHERE user_id = ? AND target_message_id = ?
        ORDER BY created_at ASC
        """,
        (user_id, message_id),
    ).fetchall()
    return [public_patch_view(row) for row in rows]
