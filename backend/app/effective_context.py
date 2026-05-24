from __future__ import annotations

import hashlib
import sqlite3
from typing import Iterable


def content_hash(content: str) -> str:
    return f"sha256:{hashlib.sha256(content.encode('utf-8')).hexdigest()}"


def applied_patches_for_message(conn: sqlite3.Connection, message_id: str) -> list[sqlite3.Row]:
    return list(
        conn.execute(
            """
            SELECT *
            FROM conversation_patches
            WHERE target_message_id = ? AND status = 'applied'
            ORDER BY target_range_start DESC, created_at DESC
            """,
            (message_id,),
        ).fetchall()
    )


def public_patch_view(patch: sqlite3.Row | dict) -> dict:
    return {
        "id": patch["id"],
        "sourceChildNodeId": patch["source_child_node_id"],
        "targetMessageId": patch["target_message_id"],
        "targetRangeStart": patch["target_range_start"],
        "targetRangeEnd": patch["target_range_end"],
        "anchorRangeStart": patch["anchor_range_start"],
        "anchorRangeEnd": patch["anchor_range_end"],
        "anchorText": patch["anchor_text"],
        "originalText": patch["original_text"],
        "replacementText": patch["replacement_text"],
        "status": patch["status"],
        "editType": patch["edit_type"],
        "mappingStatus": patch["mapping_status"],
        "archiveReason": patch["archive_reason"],
        "createdAt": patch["created_at"],
        "appliedAt": patch["applied_at"],
        "archivedAt": patch["archived_at"],
    }


def apply_patches_to_content(content: str, patches: Iterable[sqlite3.Row]) -> str:
    effective = content
    for patch in sorted(patches, key=lambda item: item["target_range_start"], reverse=True):
        start = int(patch["target_range_start"])
        end = int(patch["target_range_end"])
        if start < 0 or end < start or end > len(effective):
            continue
        if content[start:end] != patch["original_text"]:
            continue
        effective = f"{effective[:start]}{patch['replacement_text']}{effective[end:]}"
    return effective


def build_effective_message_content(conn: sqlite3.Connection, message_id: str, raw_content: str) -> str:
    return apply_patches_to_content(raw_content, applied_patches_for_message(conn, message_id))


def message_stale_after_patch(conn: sqlite3.Connection, node_id: str, created_at: str) -> bool:
    row = conn.execute(
        """
        SELECT 1
        FROM conversation_patches patches
        JOIN messages target ON target.id = patches.target_message_id
        WHERE patches.status = 'applied'
          AND target.node_id = ?
          AND target.created_at < ?
          AND patches.applied_at IS NOT NULL
          AND ? < patches.applied_at
        LIMIT 1
        """,
        (node_id, created_at, created_at),
    ).fetchone()
    return row is not None


def row_to_effective_message(conn: sqlite3.Connection, row: sqlite3.Row) -> dict:
    patches = applied_patches_for_message(conn, row["id"])
    raw_content = row["content"]
    effective_content = apply_patches_to_content(raw_content, patches)
    payload = {
        "id": row["id"],
        "role": row["role"],
        "content": effective_content,
        "originalContent": raw_content if effective_content != raw_content else None,
        "createdAt": row["created_at"],
        "selectedText": row["selected_text"],
        "patches": [public_patch_view(patch) for patch in sorted(patches, key=lambda item: item["target_range_start"])],
        "stale": message_stale_after_patch(conn, row["node_id"], row["created_at"]),
    }
    return payload


def list_effective_messages(
    conn: sqlite3.Connection,
    node_id: str,
    *,
    limit: int | None = None,
    before_created_at: str | None = None,
    ascending: bool = True,
) -> list[dict]:
    created_filter = "AND created_at <= ?" if before_created_at else ""
    limit_clause = "LIMIT ?" if limit is not None else ""
    order = "ASC" if ascending else "DESC"
    params: list[object] = [node_id]
    if before_created_at:
        params.append(before_created_at)
    if limit is not None:
        params.append(limit)
    rows = conn.execute(
        f"""
        SELECT id, node_id, role, content, selected_text, created_at
        FROM messages
        WHERE node_id = ? AND role IN ('user', 'assistant')
        {created_filter}
        ORDER BY created_at {order}
        {limit_clause}
        """,
        tuple(params),
    ).fetchall()
    messages = [row_to_effective_message(conn, row) for row in rows]
    return list(reversed(messages)) if not ascending else messages
