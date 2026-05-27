from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from typing import Iterable
from uuid import uuid4

from .settings import get_database_path


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def uid(prefix: str) -> str:
    return f"{prefix}-{uuid4().hex[:12]}"


def connect() -> sqlite3.Connection:
    conn = sqlite3.connect(get_database_path())
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db() -> None:
    with connect() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
              id TEXT PRIMARY KEY,
              email TEXT NOT NULL UNIQUE,
              display_name TEXT NOT NULL,
              password_hash TEXT NOT NULL,
              is_temporary INTEGER NOT NULL DEFAULT 0,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS notebooks (
              id TEXT PRIMARY KEY,
              owner_user_id TEXT,
              title TEXT NOT NULL,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              pinned INTEGER NOT NULL DEFAULT 0,
              FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS nodes (
              id TEXT PRIMARY KEY,
              notebook_id TEXT NOT NULL,
              parent_id TEXT REFERENCES nodes(id) ON DELETE CASCADE,
              title TEXT NOT NULL,
              summary TEXT NOT NULL DEFAULT '',
              selected_text TEXT,
              source_metadata_json TEXT,
              summary_stale INTEGER NOT NULL DEFAULT 0,
              context_mode TEXT NOT NULL DEFAULT 'isolated',
              position INTEGER NOT NULL DEFAULT 0,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              FOREIGN KEY (notebook_id) REFERENCES notebooks(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_nodes_notebook_parent
              ON nodes(notebook_id, parent_id, position);

            CREATE TABLE IF NOT EXISTS messages (
              id TEXT PRIMARY KEY,
              node_id TEXT NOT NULL,
              role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
              content TEXT NOT NULL,
              selected_text TEXT,
              created_at TEXT NOT NULL,
              FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_messages_node_created
              ON messages(node_id, created_at);

            CREATE TABLE IF NOT EXISTS conversation_patches (
              id TEXT PRIMARY KEY,
              user_id TEXT NOT NULL,
              parent_node_id TEXT NOT NULL,
              source_child_node_id TEXT,
              source_snapshot_json TEXT NOT NULL,
              target_message_id TEXT NOT NULL,
              target_message_role TEXT NOT NULL,
              target_message_created_at TEXT NOT NULL,
              base_message_content_hash TEXT NOT NULL,
              base_content_length INTEGER NOT NULL,
              coordinate_space TEXT NOT NULL DEFAULT 'raw_markdown',
              selector_strategy TEXT NOT NULL,
              anchor_range_start INTEGER NOT NULL,
              anchor_range_end INTEGER NOT NULL,
              target_range_start INTEGER NOT NULL,
              target_range_end INTEGER NOT NULL,
              anchor_text TEXT NOT NULL,
              anchor_prefix TEXT NOT NULL DEFAULT '',
              anchor_suffix TEXT NOT NULL DEFAULT '',
              original_text TEXT NOT NULL,
              replacement_text TEXT NOT NULL,
              status TEXT NOT NULL CHECK(status IN ('draft', 'applied', 'rejected', 'archived')),
              edit_type TEXT NOT NULL CHECK(edit_type IN ('correct', 'expand', 'compress', 'reframe')),
              mapping_status TEXT NOT NULL DEFAULT 'exact' CHECK(mapping_status IN ('exact', 'stale', 'unmapped')),
              conflict_patch_id TEXT,
              archive_reason TEXT,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              applied_at TEXT,
              archived_at TEXT,
              FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_conversation_patches_target_status
              ON conversation_patches(target_message_id, status);

            CREATE INDEX IF NOT EXISTS idx_conversation_patches_user_source
              ON conversation_patches(user_id, source_child_node_id);

            CREATE TABLE IF NOT EXISTS web_sources (
              id TEXT PRIMARY KEY,
              user_id TEXT NOT NULL,
              notebook_id TEXT NOT NULL,
              node_id TEXT NOT NULL,
              url TEXT NOT NULL,
              title TEXT NOT NULL,
              snippet TEXT NOT NULL DEFAULT '',
              content TEXT NOT NULL,
              provider TEXT NOT NULL,
              created_at TEXT NOT NULL,
              FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
              FOREIGN KEY (notebook_id) REFERENCES notebooks(id) ON DELETE CASCADE,
              FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_web_sources_user_node_created
              ON web_sources(user_id, node_id, created_at DESC);

            CREATE TABLE IF NOT EXISTS long_tasks (
              id TEXT PRIMARY KEY,
              user_id TEXT NOT NULL,
              notebook_id TEXT,
              node_id TEXT,
              title TEXT,
              original_question TEXT NOT NULL,
              status TEXT NOT NULL,
              current_step_index INTEGER DEFAULT 0,
              plan_json TEXT,
              plan_summary TEXT,
              model_name TEXT,
              thinking_mode TEXT,
              final_answer TEXT,
              error_message TEXT,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              finished_at TEXT,
              FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
              FOREIGN KEY (notebook_id) REFERENCES notebooks(id) ON DELETE CASCADE,
              FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS long_task_steps (
              id TEXT PRIMARY KEY,
              task_id TEXT NOT NULL,
              user_id TEXT NOT NULL,
              node_id TEXT,
              step_index INTEGER NOT NULL,
              title TEXT NOT NULL,
              goal TEXT NOT NULL,
              step_type TEXT NOT NULL,
              status TEXT NOT NULL,
              need_retrieval INTEGER NOT NULL DEFAULT 0,
              retrieval_mode TEXT NOT NULL DEFAULT 'none',
              depends_on TEXT,
              input_summary TEXT,
              output_summary TEXT,
              error_message TEXT,
              started_at TEXT,
              finished_at TEXT,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              FOREIGN KEY (task_id) REFERENCES long_tasks(id) ON DELETE CASCADE,
              FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
              FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS task_evidence (
              id TEXT PRIMARY KEY,
              task_id TEXT NOT NULL,
              step_id TEXT NOT NULL,
              user_id TEXT NOT NULL,
              node_id TEXT,
              source_type TEXT NOT NULL,
              source_id TEXT,
              title TEXT,
              url TEXT,
              page_number INTEGER,
              evidence_text TEXT NOT NULL,
              relevance_score REAL,
              token_estimate INTEGER,
              char_count INTEGER,
              created_at TEXT NOT NULL,
              FOREIGN KEY (task_id) REFERENCES long_tasks(id) ON DELETE CASCADE,
              FOREIGN KEY (step_id) REFERENCES long_task_steps(id) ON DELETE CASCADE,
              FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
              FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS step_outputs (
              id TEXT PRIMARY KEY,
              task_id TEXT NOT NULL,
              step_id TEXT NOT NULL,
              user_id TEXT NOT NULL,
              node_id TEXT,
              output_type TEXT NOT NULL,
              content TEXT NOT NULL,
              summary TEXT,
              confidence REAL,
              unresolved_questions TEXT,
              created_at TEXT NOT NULL,
              FOREIGN KEY (task_id) REFERENCES long_tasks(id) ON DELETE CASCADE,
              FOREIGN KEY (step_id) REFERENCES long_task_steps(id) ON DELETE CASCADE,
              FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
              FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS model_call_logs (
              id TEXT PRIMARY KEY,
              user_id TEXT NOT NULL,
              notebook_id TEXT,
              node_id TEXT,
              task_id TEXT,
              step_id TEXT,
              call_type TEXT NOT NULL,
              model_name TEXT,
              thinking_mode TEXT,
              input_chars INTEGER,
              output_chars INTEGER,
              estimated_input_tokens INTEGER,
              estimated_output_tokens INTEGER,
              context_chars INTEGER,
              web_search_enabled INTEGER NOT NULL DEFAULT 0,
              search_result_count INTEGER NOT NULL DEFAULT 0,
              fetched_page_count INTEGER NOT NULL DEFAULT 0,
              source_count INTEGER NOT NULL DEFAULT 0,
              evidence_count INTEGER NOT NULL DEFAULT 0,
              latency_ms INTEGER,
              success INTEGER NOT NULL,
              error_message TEXT,
              created_at TEXT NOT NULL,
              FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
              FOREIGN KEY (notebook_id) REFERENCES notebooks(id) ON DELETE SET NULL,
              FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE SET NULL,
              FOREIGN KEY (task_id) REFERENCES long_tasks(id) ON DELETE CASCADE,
              FOREIGN KEY (step_id) REFERENCES long_task_steps(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_long_tasks_user_node
              ON long_tasks(user_id, node_id);

            CREATE INDEX IF NOT EXISTS idx_long_tasks_status
              ON long_tasks(user_id, status);

            CREATE INDEX IF NOT EXISTS idx_steps_task_index
              ON long_task_steps(task_id, step_index);

            CREATE INDEX IF NOT EXISTS idx_steps_status
              ON long_task_steps(task_id, status);

            CREATE INDEX IF NOT EXISTS idx_evidence_step
              ON task_evidence(step_id);

            CREATE INDEX IF NOT EXISTS idx_outputs_step
              ON step_outputs(step_id);

            CREATE INDEX IF NOT EXISTS idx_model_logs_task
              ON model_call_logs(task_id, step_id);
            """
        )
        _ensure_column(conn, "long_tasks", "model_name", "TEXT")
        _ensure_column(conn, "long_tasks", "thinking_mode", "TEXT")
        _ensure_column(conn, "model_call_logs", "thinking_mode", "TEXT")
        ensure_column(conn, "nodes", "source_metadata_json", "TEXT")
        ensure_column(conn, "nodes", "summary_stale", "INTEGER NOT NULL DEFAULT 0")
        ensure_column(conn, "users", "is_temporary", "INTEGER NOT NULL DEFAULT 0")


def _ensure_column(conn: sqlite3.Connection, table: str, column: str, column_type: str) -> None:
    columns = {row["name"] for row in conn.execute(f"PRAGMA table_info({table})").fetchall()}
    if column not in columns:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {column_type}")
        ensure_column(conn, "notebooks", "owner_user_id", "TEXT")


def ensure_column(conn: sqlite3.Connection, table_name: str, column_name: str, declaration: str) -> None:
    columns = [row["name"] for row in conn.execute(f"PRAGMA table_info({table_name})").fetchall()]
    if column_name not in columns:
        conn.execute(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {declaration}")


def seed_if_empty(conn: sqlite3.Connection) -> None:
    count = conn.execute("SELECT COUNT(*) AS count FROM notebooks").fetchone()["count"]
    if count:
        return

    ts = now_iso()
    conn.execute(
        "INSERT INTO notebooks(id, title, created_at, updated_at) VALUES (?, ?, ?, ?)",
        ("root", "TreeLearn 项目学习", ts, ts),
    )
    nodes = [
        (
            "root",
            "root",
            None,
            "TreeLearn 项目学习",
            "围绕树形上下文工程理解项目背景、核心功能、技术栈和后端协作边界。",
            None,
            "mainline",
            0,
        ),
        (
            "method",
            "root",
            "root",
            "树形上下文调度",
            "根据根节点到当前节点路径、当前节点完整内容和选中文本构造 prompt。",
            "树形上下文调度",
            "isolated",
            0,
        ),
        (
            "skill",
            "root",
            "root",
            "Skill 偏好模板",
            "保存讲解结构、深度、示例风格和推导偏好。",
            "Skill 偏好模板",
            "isolated",
            1,
        ),
        (
            "context",
            "root",
            "method",
            "主线保护策略",
            "普通支线默认隔离，避免局部追问污染主线路径摘要。",
            "普通支线默认不污染后续主线上下文",
            "isolated",
            0,
        ),
    ]
    conn.executemany(
        """
        INSERT INTO nodes(
          id, notebook_id, parent_id, title, summary, selected_text,
          context_mode, position, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        [(*node, ts, ts) for node in nodes],
    )

    messages = [
        (
            "m-root-1",
            "root",
            "assistant",
            "TreeLearn 将论文、PPT、技术文档等学习过程组织成树形知识网络。主线负责宏观学习路径，支线负责局部追问，普通支线默认不污染后续主线上下文。",
        ),
        (
            "m-root-2",
            "root",
            "assistant",
            "前端需要支持左侧树形节点、右侧阅读块与主子对话 3:7 分栏、选中文本创建子对话、分支超链接预览、Skill 偏好模板、导入导出和分享复习。",
        ),
        (
            "m-method-1",
            "method",
            "assistant",
            "树形结构不直接改变模型 attention 权重，但可以为上下文选择、排序、压缩和标注提供依据。后端可沿路径摘要、当前节点全文和选中文本构造最终 prompt。",
        ),
        (
            "m-context-1",
            "context",
            "assistant",
            "默认隔离策略能避免局部概念被模型误当成全局重点。支线内容保持在自己的节点上下文中，便于围绕局部问题继续追问。",
        ),
        (
            "m-skill-1",
            "skill",
            "assistant",
            "Skill 不是知识点总结，而是用户希望 AI 怎样讲。比如先给大纲、解释变量、给反例、遇到公式时补充推导。",
        ),
    ]
    conn.executemany(
        "INSERT INTO messages(id, node_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)",
        [(*message, ts) for message in messages],
    )


def create_starter_notebook(conn: sqlite3.Connection, user_id: str) -> str:
    notebook_id = uid("nb")
    ts = now_iso()
    conn.execute(
        """
        INSERT INTO notebooks(id, owner_user_id, title, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
        """,
        (notebook_id, user_id, "TreeLearn 入门笔记本", ts, ts),
    )

    nodes = [
        (
            notebook_id,
            notebook_id,
            None,
            "TreeLearn 入门笔记本",
            "从这里开始创建学习主题、选中文本开支线，并观察树形上下文如何影响 AI 回答。",
            None,
            "mainline",
            0,
        ),
        (
            uid("node"),
            notebook_id,
            notebook_id,
            "树形上下文调度",
            "子对话会带上父节点片段、父节点最近对话和根节点摘要，帮助模型聚焦局部问题。",
            "树形上下文调度",
            "isolated",
            0,
        ),
    ]
    conn.executemany(
        """
        INSERT INTO nodes(
          id, notebook_id, parent_id, title, summary, selected_text,
          context_mode, position, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        [(*node, ts, ts) for node in nodes],
    )
    conn.execute(
        """
        INSERT INTO messages(id, node_id, role, content, created_at)
        VALUES (?, ?, ?, ?, ?)
        """,
        (
            uid("msg"),
            notebook_id,
            "assistant",
            "欢迎使用 ArborLearn。这个账号下的笔记本、树节点和聊天记录会独立保存，不会和其他用户混在一起。",
            ts,
        ),
    )
    create_transformer_demo_notebook(conn, user_id)
    return notebook_id


def create_transformer_demo_notebook(conn: sqlite3.Connection, user_id: str) -> str:
    notebook_id = uid("nb")
    attention_id = uid("node")
    ts = now_iso()
    conn.execute(
        """
        INSERT INTO notebooks(id, owner_user_id, title, created_at, updated_at, pinned)
        VALUES (?, ?, ?, ?, ?, 1)
        """,
        (notebook_id, user_id, "Transformer 是如何工作的", ts, ts),
    )

    nodes = [
        (
            notebook_id,
            notebook_id,
            None,
            "Transformer 是如何工作的",
            "学习路线：先理解它为什么替代 RNN/CNN，再拆输入表示、自注意力、多头注意力、Encoder/Decoder，最后用例子复盘。",
            None,
            "mainline",
            0,
        ),
        (
            uid("node"),
            notebook_id,
            notebook_id,
            "1. 为什么需要 Transformer",
            "RNN 顺序处理难并行，远距离依赖路径长；Transformer 用自注意力让任意两个位置直接交互。",
            "1. 为什么需要 Transformer",
            "mainline",
            0,
        ),
        (
            uid("node"),
            notebook_id,
            notebook_id,
            "2. 输入：词向量 + 位置编码",
            "Transformer 本身不按时间顺序递归，所以要把位置信息显式加进 embedding。",
            "2. 输入：词向量 + 位置编码",
            "mainline",
            1,
        ),
        (
            attention_id,
            notebook_id,
            notebook_id,
            "3. 自注意力：每个词重新理解自己",
            "自注意力让一个词基于全句上下文更新自己的表示，而不是孤立地保留原始词义。",
            "3. 自注意力：每个词重新理解自己",
            "mainline",
            2,
        ),
        (
            uid("node"),
            notebook_id,
            attention_id,
            "3.1 Q/K/V：提问、匹配、取信息",
            "Query 用来发问，Key 用来被匹配，Value 是真正被加权汇总的信息。",
            "3.1 Q/K/V：提问、匹配、取信息",
            "isolated",
            0,
        ),
        (
            uid("node"),
            notebook_id,
            attention_id,
            "3.2 公式：softmax(QK^T / sqrt(d_k))V",
            "点积给相关性，sqrt(d_k) 稳定尺度，softmax 变权重，最后加权求和 V。",
            "3.2 公式：softmax(QK^T / sqrt(d_k))V",
            "isolated",
            1,
        ),
        (
            uid("node"),
            notebook_id,
            notebook_id,
            "4. 多头注意力：同时看多种关系",
            "一个头可能看指代，一个头可能看语法，一个头可能看语义相似；最后拼接融合。",
            "4. 多头注意力：同时看多种关系",
            "mainline",
            3,
        ),
        (
            uid("node"),
            notebook_id,
            notebook_id,
            "5. Encoder：理解输入序列",
            "Encoder 层由多头自注意力、前馈网络、残差连接和 LayerNorm 组成，堆叠后得到上下文表示。",
            "5. Encoder：理解输入序列",
            "mainline",
            4,
        ),
        (
            uid("node"),
            notebook_id,
            notebook_id,
            "6. Decoder：带遮罩地生成输出",
            "Decoder 生成时不能偷看未来 token，用 masked self-attention；再通过 cross-attention 读取 Encoder 输出。",
            "6. Decoder：带遮罩地生成输出",
            "mainline",
            5,
        ),
        (
            uid("node"),
            notebook_id,
            notebook_id,
            "7. 例子：it 指代谁，bank 是河岸还是银行",
            "Transformer 的优势可以通过消歧例子看见：词义由全句关系决定，而不是孤立词表决定。",
            "7. 例子：it 指代谁，bank 是河岸还是银行",
            "isolated",
            6,
        ),
        (
            uid("node"),
            notebook_id,
            notebook_id,
            "8. 一句话复盘",
            "Transformer = 并行处理序列 + 用注意力动态建立 token 关系 + 堆叠层逐步抽象。",
            "8. 一句话复盘",
            "mainline",
            7,
        ),
        (
            uid("node"),
            notebook_id,
            notebook_id,
            "资料来源与继续阅读",
            "原始论文、Google Research 说明和可视化讲解，是这棵树的主要依据。",
            "资料来源与继续阅读",
            "isolated",
            8,
        ),
    ]
    conn.executemany(
        """
        INSERT INTO nodes(
          id, notebook_id, parent_id, title, summary, selected_text,
          context_mode, position, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        [(*node, ts, ts) for node in nodes],
    )

    message_pairs_by_title = {
        "Transformer 是如何工作的": (
            "我想系统理解 Transformer 是如何工作的，不只是背公式。",
            "这棵树把 Transformer 拆成 8 个可点击分支：\n\n"
            "分支一：1. 为什么需要 Transformer\n"
            "分支二：2. 输入：词向量 + 位置编码\n"
            "分支三：3. 自注意力：每个词重新理解自己\n"
            "分支四：4. 多头注意力：同时看多种关系\n"
            "分支五：5. Encoder：理解输入序列\n"
            "分支六：6. Decoder：带遮罩地生成输出\n"
            "分支七：7. 例子：it 指代谁，bank 是河岸还是银行\n"
            "分支八：8. 一句话复盘\n\n"
            "自注意力分支还继续展开为 3.1 Q/K/V：提问、匹配、取信息 和 3.2 公式：softmax(QK^T / sqrt(d_k))V。"
            "最后可以用 资料来源与继续阅读 追溯原始资料。",
        ),
        "1. 为什么需要 Transformer": (
            "Transformer 解决了什么问题？",
            "传统 RNN 像从左到右读句子：后面的词要等前面的词处理完，训练很难充分并行；"
            "如果两个词相距很远，信息传递要走很多步。Transformer 的核心改变是：每一层都让一个 token "
            "直接和所有 token 计算关系，所以长距离依赖可以在少量层里建立，GPU/TPU 也更容易并行。",
        ),
        "2. 输入：词向量 + 位置编码": (
            "Transformer 怎么知道词的顺序？",
            "每个 token 先变成 embedding，表示它的语义；再加上 positional encoding，表示它在序列中的位置。"
            "没有位置编码时，纯注意力对词序不敏感，“狗咬人”和“人咬狗”会更难区分。",
        ),
        "3. 自注意力：每个词重新理解自己": (
            "Self-Attention 到底在做什么？",
            "自注意力不是只给每个词一个固定向量，而是让每个词问：为了理解我，句子里的哪些词最重要？\n\n"
            "例如处理 it 时，模型会看 animal、street、tired 等词，给它们不同权重，然后把相关词的信息混入 it 的新表示。"
            "这样，一个词的向量就从“字面词义”变成“带上下文的词义”。\n\n"
            "这个机制可以继续拆成 3.1 Q/K/V：提问、匹配、取信息 和 3.2 公式：softmax(QK^T / sqrt(d_k))V 两个分支。",
        ),
        "3.1 Q/K/V：提问、匹配、取信息": (
            "Query、Key、Value 怎么理解？",
            "Query 是当前 token 提出的问题，Key 是每个 token 展示的匹配标签，Value 是真正被取走的信息。"
            "计算时，用 Query 和所有 Key 做相似度，得到权重；再按权重汇总 Value，形成当前词的新表示。",
        ),
        "3.2 公式：softmax(QK^T / sqrt(d_k))V": (
            "注意力公式每一项是什么意思？",
            "QK^T 给相关性分数，sqrt(d_k) 用来稳定尺度，softmax 把分数变成总和为 1 的权重，最后乘 V 完成信息汇总。"
            "所以公式本质是：先判断“看谁”，再决定“拿多少信息”。",
        ),
        "4. 多头注意力：同时看多种关系": (
            "为什么要多头，而不是一个注意力？",
            "一个注意力头容易形成单一关注模式。多头注意力会在多个子空间里独立计算注意力，再拼接融合。"
            "同一句话里可能同时有指代、修饰、语法和主题关系，多头机制让模型能并行捕捉这些不同关系。",
        ),
        "5. Encoder：理解输入序列": (
            "Encoder 一层里面有什么？",
            "典型 Encoder block 包含 Multi-Head Self-Attention、Add & Norm、Feed-Forward Network、再一次 Add & Norm。"
            "多个 block 堆叠后，每个 token 的表示会包含越来越丰富的全局上下文。",
        ),
        "6. Decoder：带遮罩地生成输出": (
            "Decoder 和 Encoder 最大区别是什么？",
            "Decoder 要逐步生成下一个 token，所以 masked self-attention 不能看未来答案；同时它通过 cross-attention "
            "读取 Encoder 输出。Encoder 更像理解器，Decoder 更像参考输入后逐步写作的生成器。",
        ),
        "7. 例子：it 指代谁，bank 是河岸还是银行": (
            "能不能用一个句子看出注意力的作用？",
            "例子：The animal did not cross the street because it was too tired。处理 it 时，注意力可能高权重看 animal 和 tired。"
            "再如 I arrived at the bank after crossing the river，bank 会因为 river 更偏向“河岸”。这说明词义由上下文关系决定。",
        ),
        "8. 一句话复盘": (
            "最后怎么把 Transformer 串起来？",
            "Transformer 先把 token 变成带位置信息的向量，再用自注意力让每个 token 直接读取全句相关信息；"
            "多头注意力提供多个关系视角；Encoder 理解输入，Decoder 在遮罩约束下参考 Encoder 输出并逐步生成。",
        ),
        "资料来源与继续阅读": (
            "这些节点依据哪些资料？",
            "主要来源包括 Vaswani et al. 的 Attention Is All You Need、Google Research 对 Transformer 架构的说明，"
            "以及 The Illustrated Transformer。阅读顺序建议：先看动机和例子，再看 Q/K/V 与公式，最后回到原论文确认细节。",
        ),
    }
    message_pairs = {node[0]: message_pairs_by_title[node[3]] for node in nodes}
    for node_id, user_and_assistant in message_pairs.items():
        for role, content in zip(("user", "assistant"), user_and_assistant):
            conn.execute(
                """
                INSERT INTO messages(id, node_id, role, content, created_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (uid("msg"), node_id, role, content, ts),
            )

    return notebook_id


def row_to_message(conn: sqlite3.Connection, row: sqlite3.Row) -> dict:
    from .effective_context import row_to_effective_message

    return row_to_effective_message(conn, row)


def list_messages(conn: sqlite3.Connection, node_id: str) -> list[dict]:
    rows = conn.execute(
        """
        SELECT id, node_id, role, content, selected_text, created_at
        FROM messages
        WHERE node_id = ?
        ORDER BY created_at ASC
        """,
        (node_id,),
    ).fetchall()
    return [row_to_message(conn, row) for row in rows]


def add_message(
    conn: sqlite3.Connection,
    node_id: str,
    role: str,
    content: str,
    message_id: str | None = None,
    selected_text: str | None = None,
) -> dict:
    msg_id = message_id or uid("msg")
    ts = now_iso()
    conn.execute(
        """
        INSERT INTO messages(id, node_id, role, content, selected_text, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (msg_id, node_id, role, content, selected_text, ts),
    )
    touch_node(conn, node_id, ts)
    return {
        "id": msg_id,
        "role": role,
        "content": content,
        "originalContent": None,
        "patches": [],
        "stale": False,
        "selectedText": selected_text,
        "createdAt": ts,
    }


def row_to_web_source(row: sqlite3.Row, include_content: bool = False) -> dict:
    source = {
        "id": row["id"],
        "nodeId": row["node_id"],
        "notebookId": row["notebook_id"],
        "title": row["title"],
        "url": row["url"],
        "snippet": row["snippet"],
        "provider": row["provider"],
        "createdAt": row["created_at"],
    }
    if include_content:
        source["content"] = row["content"]
    return source


def add_web_source(
    conn: sqlite3.Connection,
    user_id: str,
    notebook_id: str,
    node_id: str,
    *,
    title: str,
    url: str,
    snippet: str,
    content: str,
    provider: str,
) -> dict:
    source_id = uid("src")
    ts = now_iso()
    conn.execute(
        """
        INSERT INTO web_sources(
          id, user_id, notebook_id, node_id, url, title, snippet, content, provider, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (source_id, user_id, notebook_id, node_id, url, title, snippet, content, provider, ts),
    )
    return {
        "id": source_id,
        "nodeId": node_id,
        "notebookId": notebook_id,
        "title": title,
        "url": url,
        "snippet": snippet,
        "content": content,
        "provider": provider,
        "createdAt": ts,
    }


def list_web_sources(
    conn: sqlite3.Connection,
    user_id: str,
    node_id: str,
    limit: int = 10,
    include_content: bool = False,
) -> list[dict]:
    rows = conn.execute(
        """
        SELECT id, user_id, notebook_id, node_id, url, title, snippet, content, provider, created_at
        FROM web_sources
        WHERE user_id = ? AND node_id = ?
        ORDER BY created_at DESC
        LIMIT ?
        """,
        (user_id, node_id, limit),
    ).fetchall()
    return [row_to_web_source(row, include_content=include_content) for row in rows]


def row_to_long_task(row: sqlite3.Row, include_final_answer: bool = True) -> dict:
    task = {
        "id": row["id"],
        "user_id": row["user_id"],
        "notebook_id": row["notebook_id"],
        "node_id": row["node_id"],
        "title": row["title"],
        "original_question": row["original_question"],
        "status": row["status"],
        "current_step_index": row["current_step_index"],
        "plan_json": row["plan_json"],
        "plan_summary": row["plan_summary"],
        "model_name": row["model_name"],
        "thinking_mode": row["thinking_mode"],
        "error_message": row["error_message"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "finished_at": row["finished_at"],
    }
    if include_final_answer:
        task["final_answer"] = row["final_answer"]
    return task


def row_to_long_task_step(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "task_id": row["task_id"],
        "user_id": row["user_id"],
        "node_id": row["node_id"],
        "step_index": row["step_index"],
        "title": row["title"],
        "goal": row["goal"],
        "step_type": row["step_type"],
        "status": row["status"],
        "need_retrieval": bool(row["need_retrieval"]),
        "retrieval_mode": row["retrieval_mode"],
        "depends_on": row["depends_on"],
        "input_summary": row["input_summary"],
        "output_summary": row["output_summary"],
        "error_message": row["error_message"],
        "started_at": row["started_at"],
        "finished_at": row["finished_at"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def row_to_task_evidence(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "task_id": row["task_id"],
        "step_id": row["step_id"],
        "user_id": row["user_id"],
        "node_id": row["node_id"],
        "source_type": row["source_type"],
        "source_id": row["source_id"],
        "title": row["title"],
        "url": row["url"],
        "page_number": row["page_number"],
        "evidence_text": row["evidence_text"],
        "relevance_score": row["relevance_score"],
        "token_estimate": row["token_estimate"],
        "char_count": row["char_count"],
        "created_at": row["created_at"],
    }


def row_to_step_output(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "task_id": row["task_id"],
        "step_id": row["step_id"],
        "user_id": row["user_id"],
        "node_id": row["node_id"],
        "output_type": row["output_type"],
        "content": row["content"],
        "summary": row["summary"],
        "confidence": row["confidence"],
        "unresolved_questions": row["unresolved_questions"],
        "created_at": row["created_at"],
    }


def create_long_task(
    conn: sqlite3.Connection,
    user_id: str,
    *,
    original_question: str,
    title: str | None = None,
    notebook_id: str | None = None,
    node_id: str | None = None,
    model_name: str | None = None,
    thinking_mode: str | None = None,
) -> dict:
    task_id = uid("task")
    ts = now_iso()
    conn.execute(
        """
        INSERT INTO long_tasks(
          id, user_id, notebook_id, node_id, title, original_question, status,
          current_step_index, model_name, thinking_mode, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, 'CREATED', 0, ?, ?, ?, ?)
        """,
        (task_id, user_id, notebook_id, node_id, title, original_question, model_name, thinking_mode, ts, ts),
    )
    row = conn.execute("SELECT * FROM long_tasks WHERE id = ?", (task_id,)).fetchone()
    return row_to_long_task(row)


def get_long_task_for_user(conn: sqlite3.Connection, user_id: str, task_id: str) -> dict | None:
    row = conn.execute(
        "SELECT * FROM long_tasks WHERE id = ? AND user_id = ?",
        (task_id, user_id),
    ).fetchone()
    return row_to_long_task(row) if row else None


def list_long_tasks_for_node(conn: sqlite3.Connection, user_id: str, node_id: str, limit: int = 20) -> list[dict]:
    rows = conn.execute(
        """
        SELECT *
        FROM long_tasks
        WHERE user_id = ? AND node_id = ?
        ORDER BY datetime(updated_at) DESC, datetime(created_at) DESC
        LIMIT ?
        """,
        (user_id, node_id, limit),
    ).fetchall()
    return [row_to_long_task(row) for row in rows]


def list_long_task_steps(conn: sqlite3.Connection, user_id: str, task_id: str) -> list[dict]:
    rows = conn.execute(
        """
        SELECT *
        FROM long_task_steps
        WHERE task_id = ? AND user_id = ?
        ORDER BY step_index ASC
        """,
        (task_id, user_id),
    ).fetchall()
    return [row_to_long_task_step(row) for row in rows]


def get_long_task_step_for_user(conn: sqlite3.Connection, user_id: str, task_id: str, step_id: str) -> dict | None:
    row = conn.execute(
        """
        SELECT *
        FROM long_task_steps
        WHERE id = ? AND task_id = ? AND user_id = ?
        """,
        (step_id, task_id, user_id),
    ).fetchone()
    return row_to_long_task_step(row) if row else None


def save_long_task_plan(conn: sqlite3.Connection, user_id: str, task_id: str, plan_json: str, plan_summary: str) -> None:
    ts = now_iso()
    conn.execute(
        """
        UPDATE long_tasks
        SET plan_json = ?, plan_summary = ?, updated_at = ?
        WHERE id = ? AND user_id = ?
        """,
        (plan_json, plan_summary, ts, task_id, user_id),
    )


def replace_long_task_steps(
    conn: sqlite3.Connection,
    *,
    user_id: str,
    task_id: str,
    node_id: str | None,
    steps: list[dict],
) -> list[dict]:
    conn.execute("DELETE FROM long_task_steps WHERE task_id = ? AND user_id = ?", (task_id, user_id))
    ts = now_iso()
    saved_steps: list[dict] = []
    for index, step in enumerate(steps):
        step_id = uid("step")
        conn.execute(
            """
            INSERT INTO long_task_steps(
              id, task_id, user_id, node_id, step_index, title, goal, step_type, status,
              need_retrieval, retrieval_mode, depends_on, input_summary, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?, ?, ?, ?)
            """,
            (
                step_id,
                task_id,
                user_id,
                node_id,
                int(step.get("index", index)),
                str(step.get("title") or f"步骤 {index + 1}")[:160],
                str(step.get("goal") or step.get("expected_output") or "完成当前子任务"),
                str(step.get("step_type") or "analyze"),
                1 if step.get("need_retrieval") else 0,
                str(step.get("retrieval_mode") or ("standard" if step.get("need_retrieval") else "none")),
                step.get("depends_on"),
                step.get("expected_output") or step.get("input_summary"),
                ts,
                ts,
            ),
        )
        row = conn.execute("SELECT * FROM long_task_steps WHERE id = ?", (step_id,)).fetchone()
        saved_steps.append(row_to_long_task_step(row))
    return saved_steps


def update_long_task_status(
    conn: sqlite3.Connection,
    user_id: str,
    task_id: str,
    status: str,
    *,
    error_message: str | None = None,
    final_answer: str | None = None,
    current_step_index: int | None = None,
    finished: bool = False,
) -> None:
    ts = now_iso()
    finished_at = ts if finished else None
    conn.execute(
        """
        UPDATE long_tasks
        SET status = ?,
            error_message = ?,
            final_answer = COALESCE(?, final_answer),
            current_step_index = COALESCE(?, current_step_index),
            updated_at = ?,
            finished_at = COALESCE(?, finished_at)
        WHERE id = ? AND user_id = ?
        """,
        (status, error_message, final_answer, current_step_index, ts, finished_at, task_id, user_id),
    )


def update_task_current_step(conn: sqlite3.Connection, user_id: str, task_id: str, step_index: int) -> None:
    conn.execute(
        "UPDATE long_tasks SET current_step_index = ?, updated_at = ? WHERE id = ? AND user_id = ?",
        (step_index, now_iso(), task_id, user_id),
    )


def update_long_task_step_status(
    conn: sqlite3.Connection,
    user_id: str,
    step_id: str,
    status: str,
    *,
    output_summary: str | None = None,
    error_message: str | None = None,
) -> None:
    ts = now_iso()
    started_at = ts if status == "RUNNING" else None
    finished_at = ts if status in {"DONE", "FAILED", "SKIPPED"} else None
    conn.execute(
        """
        UPDATE long_task_steps
        SET status = ?,
            output_summary = COALESCE(?, output_summary),
            error_message = ?,
            started_at = COALESCE(started_at, ?),
            finished_at = COALESCE(?, finished_at),
            updated_at = ?
        WHERE id = ? AND user_id = ?
        """,
        (status, output_summary, error_message, started_at, finished_at, ts, step_id, user_id),
    )


def list_task_evidence(
    conn: sqlite3.Connection,
    user_id: str,
    task_id: str,
    step_id: str | None = None,
    limit: int = 50,
) -> list[dict]:
    step_filter = "AND step_id = ?" if step_id else ""
    params: tuple = (user_id, task_id, step_id, limit) if step_id else (user_id, task_id, limit)
    rows = conn.execute(
        f"""
        SELECT *
        FROM task_evidence
        WHERE user_id = ? AND task_id = ?
        {step_filter}
        ORDER BY COALESCE(relevance_score, 0) DESC, created_at ASC
        LIMIT ?
        """,
        params,
    ).fetchall()
    return [row_to_task_evidence(row) for row in rows]


def add_task_evidence(
    conn: sqlite3.Connection,
    *,
    user_id: str,
    task_id: str,
    step_id: str,
    node_id: str | None,
    source_type: str,
    evidence_text: str,
    source_id: str | None = None,
    title: str | None = None,
    url: str | None = None,
    page_number: int | None = None,
    relevance_score: float | None = None,
) -> dict:
    evidence_id = uid("ev")
    ts = now_iso()
    char_count = len(evidence_text)
    conn.execute(
        """
        INSERT INTO task_evidence(
          id, task_id, step_id, user_id, node_id, source_type, source_id, title, url,
          page_number, evidence_text, relevance_score, token_estimate, char_count, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            evidence_id,
            task_id,
            step_id,
            user_id,
            node_id,
            source_type,
            source_id,
            title,
            url,
            page_number,
            evidence_text,
            relevance_score,
            char_count // 4,
            char_count,
            ts,
        ),
    )
    row = conn.execute("SELECT * FROM task_evidence WHERE id = ?", (evidence_id,)).fetchone()
    return row_to_task_evidence(row)


def add_step_output(
    conn: sqlite3.Connection,
    *,
    user_id: str,
    task_id: str,
    step_id: str,
    node_id: str | None,
    output_type: str,
    content: str,
    summary: str | None = None,
    confidence: float | None = None,
    unresolved_questions: str | None = None,
) -> dict:
    output_id = uid("out")
    ts = now_iso()
    conn.execute(
        """
        INSERT INTO step_outputs(
          id, task_id, step_id, user_id, node_id, output_type, content, summary,
          confidence, unresolved_questions, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (output_id, task_id, step_id, user_id, node_id, output_type, content, summary, confidence, unresolved_questions, ts),
    )
    row = conn.execute("SELECT * FROM step_outputs WHERE id = ?", (output_id,)).fetchone()
    return row_to_step_output(row)


def list_step_outputs(
    conn: sqlite3.Connection,
    user_id: str,
    task_id: str,
    step_id: str | None = None,
    limit: int = 50,
) -> list[dict]:
    step_filter = "AND step_id = ?" if step_id else ""
    params: tuple = (user_id, task_id, step_id, limit) if step_id else (user_id, task_id, limit)
    rows = conn.execute(
        f"""
        SELECT *
        FROM step_outputs
        WHERE user_id = ? AND task_id = ?
        {step_filter}
        ORDER BY created_at ASC
        LIMIT ?
        """,
        params,
    ).fetchall()
    return [row_to_step_output(row) for row in rows]


def insert_model_call_log(
    conn: sqlite3.Connection,
    *,
    user_id: str,
    call_type: str,
    success: bool,
    notebook_id: str | None = None,
    node_id: str | None = None,
    task_id: str | None = None,
    step_id: str | None = None,
    model_name: str | None = None,
    thinking_mode: str | None = None,
    input_chars: int | None = None,
    output_chars: int | None = None,
    estimated_input_tokens: int | None = None,
    estimated_output_tokens: int | None = None,
    context_chars: int | None = None,
    web_search_enabled: bool = False,
    search_result_count: int = 0,
    fetched_page_count: int = 0,
    source_count: int = 0,
    evidence_count: int = 0,
    latency_ms: int | None = None,
    error_message: str | None = None,
) -> dict:
    log_id = uid("log")
    ts = now_iso()
    conn.execute(
        """
        INSERT INTO model_call_logs(
          id, user_id, notebook_id, node_id, task_id, step_id, call_type, model_name, thinking_mode,
          input_chars, output_chars, estimated_input_tokens, estimated_output_tokens,
          context_chars, web_search_enabled, search_result_count, fetched_page_count,
          source_count, evidence_count, latency_ms, success, error_message, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            log_id,
            user_id,
            notebook_id,
            node_id,
            task_id,
            step_id,
            call_type,
            model_name,
            thinking_mode,
            input_chars,
            output_chars,
            estimated_input_tokens,
            estimated_output_tokens,
            context_chars,
            1 if web_search_enabled else 0,
            search_result_count,
            fetched_page_count,
            source_count,
            evidence_count,
            latency_ms,
            1 if success else 0,
            error_message,
            ts,
        ),
    )
    row = conn.execute("SELECT * FROM model_call_logs WHERE id = ?", (log_id,)).fetchone()
    return dict(row)


def clear_step_artifacts_from_index(conn: sqlite3.Connection, user_id: str, task_id: str, step_index: int) -> None:
    steps = conn.execute(
        """
        SELECT id
        FROM long_task_steps
        WHERE user_id = ? AND task_id = ? AND step_index >= ?
        """,
        (user_id, task_id, step_index),
    ).fetchall()
    step_ids = [row["id"] for row in steps]
    for step_id in step_ids:
        conn.execute("DELETE FROM step_outputs WHERE user_id = ? AND step_id = ?", (user_id, step_id))
        conn.execute("DELETE FROM task_evidence WHERE user_id = ? AND step_id = ?", (user_id, step_id))
        conn.execute(
            """
            UPDATE long_task_steps
            SET status = 'PENDING',
                output_summary = NULL,
                error_message = NULL,
                started_at = NULL,
                finished_at = NULL,
                updated_at = ?
            WHERE id = ? AND user_id = ?
            """,
            (now_iso(), step_id, user_id),
        )


def touch_node(conn: sqlite3.Connection, node_id: str, ts: str | None = None) -> None:
    timestamp = ts or now_iso()
    node = conn.execute("SELECT notebook_id FROM nodes WHERE id = ?", (node_id,)).fetchone()
    if not node:
        return
    conn.execute("UPDATE nodes SET updated_at = ? WHERE id = ?", (timestamp, node_id))
    conn.execute("UPDATE notebooks SET updated_at = ? WHERE id = ?", (timestamp, node["notebook_id"]))


def row_to_node(conn: sqlite3.Connection, row: sqlite3.Row, children: Iterable[str]) -> dict:
    source_metadata = None
    if row["source_metadata_json"]:
        try:
            source_metadata = json.loads(row["source_metadata_json"])
        except json.JSONDecodeError:
            source_metadata = None
    return {
        "id": row["id"],
        "parentId": row["parent_id"],
        "title": row["title"],
        "kind": "main" if row["parent_id"] is None else "branch",
        "summary": row["summary"],
        "summaryStale": bool(row["summary_stale"]),
        "selectedText": row["selected_text"],
        "sourceMetadata": source_metadata,
        "contextWeight": row["context_mode"],
        "children": list(children),
        "messages": list_messages(conn, row["id"]),
        "expanded": True,
        "updatedAt": row["updated_at"],
    }


def get_notebook_state(conn: sqlite3.Connection, user_id: str, notebook_id: str | None = None) -> dict:
    params: list[str] = [user_id]
    where = "WHERE notebook_id IN (SELECT id FROM notebooks WHERE owner_user_id = ?)"
    if notebook_id:
        where += " AND notebook_id = ?"
        params.append(notebook_id)
    rows = conn.execute(
        f"""
        SELECT id, notebook_id, parent_id, title, summary, selected_text, source_metadata_json,
               summary_stale, context_mode, updated_at, position
        FROM nodes
        {where}
        ORDER BY position ASC, created_at ASC
        """,
        tuple(params),
    ).fetchall()

    children_by_parent: dict[str, list[str]] = {}
    for row in rows:
        parent_id = row["parent_id"]
        if parent_id is not None:
            children_by_parent.setdefault(parent_id, []).append(row["id"])

    nodes = {row["id"]: row_to_node(conn, row, children_by_parent.get(row["id"], [])) for row in rows}

    notebook_query = "SELECT id, pinned FROM notebooks WHERE owner_user_id = ?"
    notebook_params: list[str] = [user_id]
    if notebook_id:
        notebook_query += " AND id = ?"
        notebook_params.append(notebook_id)
    notebook_query += " ORDER BY pinned DESC, updated_at DESC"
    notebooks = conn.execute(notebook_query, tuple(notebook_params)).fetchall()

    return {
        "nodes": nodes,
        "rootIds": [row["id"] for row in notebooks],
        "pinnedRootIds": [row["id"] for row in notebooks if row["pinned"]],
    }


def get_node_for_user(conn: sqlite3.Connection, node_id: str, user_id: str) -> sqlite3.Row | None:
    return conn.execute(
        """
        SELECT nodes.id, nodes.notebook_id, nodes.parent_id, nodes.source_metadata_json
        FROM nodes
        JOIN notebooks ON notebooks.id = nodes.notebook_id
        WHERE nodes.id = ? AND notebooks.owner_user_id = ?
        """,
        (node_id, user_id),
    ).fetchone()


def get_notebook_for_user(conn: sqlite3.Connection, notebook_id: str, user_id: str) -> sqlite3.Row | None:
    return conn.execute(
        "SELECT id FROM notebooks WHERE id = ? AND owner_user_id = ?",
        (notebook_id, user_id),
    ).fetchone()


def get_parent_chain(conn: sqlite3.Connection, node_id: str) -> list[sqlite3.Row]:
    chain: list[sqlite3.Row] = []
    current_id: str | None = node_id
    seen: set[str] = set()
    while current_id:
        if current_id in seen:
            raise ValueError("Cycle detected in node parent chain")
        seen.add(current_id)
        row = conn.execute(
            """
            SELECT id, notebook_id, parent_id, title, summary, selected_text, source_metadata_json,
                   summary_stale, context_mode
            FROM nodes
            WHERE id = ?
            """,
            (current_id,),
        ).fetchone()
        if not row:
            break
        chain.append(row)
        current_id = row["parent_id"]
    return list(reversed(chain))


def descendant_ids(conn: sqlite3.Connection, node_id: str) -> list[str]:
    rows = conn.execute(
        """
        WITH RECURSIVE subtree(id) AS (
          SELECT id FROM nodes WHERE id = ?
          UNION ALL
          SELECT nodes.id FROM nodes JOIN subtree ON nodes.parent_id = subtree.id
        )
        SELECT id FROM subtree
        """,
        (node_id,),
    ).fetchall()
    return [row["id"] for row in rows]
