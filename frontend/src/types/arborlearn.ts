// 节点类型：main 表示每个笔记本的根主线，branch 表示从主线或片段展开的子对话。
export type NodeKind = "main" | "branch";

// 消息角色保持和常见大模型接口一致，后端接入时可直接映射到 chat messages。
export type Role = "user" | "assistant" | "system";

// 上下文权重用于表达节点是否进入主线路径摘要；当前前端只展示，真正调度由后端实现。
export type ContextWeight = "isolated" | "mainline";

export interface ChatMessage {
  // 前端临时 id；后端上线后建议替换为数据库消息 id。
  id: string;
  role: Role;
  content: string;
  originalContent?: string | null;
  // ISO 字符串便于排序、序列化和与后端时间字段对齐。
  createdAt: string;
  // 预留：消息中可以显式链接到某个子节点。
  linkedNodeId?: string;
  // 如果消息由选中文本触发，这里记录触发片段。
  selectedText?: string;
  patches?: ConversationPatch[];
  stale?: boolean;
  attachments?: Array<{
    id: string;
    filename: string;
    mimeType?: string | null;
    fileSize: number;
    extractionStatus: "pending" | "ready" | "failed";
    errorMessage?: string | null;
    localFile?: File;
  }>;
}

export interface KnowledgeNode {
  // 节点是 ArborLearn 的核心数据单元；一棵树由 parentId 和 children 共同维护。
  id: string;
  parentId: string | null;
  title: string;
  kind: NodeKind;
  summary: string;
  summaryStale?: boolean;
  selectedText?: string;
  sourceMetadata?: BackfillSourceMetadata | null;
  contextWeight: ContextWeight;
  // children 只保存子节点 id，节点详情统一存在 store.nodes，便于更新和删除。
  children: string[];
  messages: ChatMessage[];
  // 左侧树是否展开该节点。
  expanded: boolean;
  updatedAt: string;
}

export interface SkillTemplate {
  // Skill 表达“AI 应该怎样讲”，不是知识内容本身；后端可把启用项拼入 prompt。
  id: string;
  name: string;
  tags: string[];
  depth: "概览" | "深入" | "推导";
  structure: string;
  enabled: boolean;
}

export interface SelectionDraft {
  // 用户在消息区划选后暂存的选区信息，用来定位悬浮操作条。
  text: string;
  rect: DOMRect;
  sourceNodeId: string;
  sourceMetadata?: BackfillSourceMetadata;
}

export type EditType = "correct" | "expand" | "compress" | "reframe";

export interface ConversationPatch {
  id: string;
  sourceChildNodeId?: string | null;
  targetMessageId: string;
  targetRangeStart: number;
  targetRangeEnd: number;
  anchorRangeStart: number;
  anchorRangeEnd: number;
  anchorText: string;
  originalText: string;
  replacementText: string;
  status: "draft" | "applied" | "rejected" | "archived";
  editType: EditType;
  mappingStatus?: "exact" | "stale" | "unmapped";
  archiveReason?: string | null;
  createdAt?: string;
  appliedAt?: string | null;
  archivedAt?: string | null;
}

export interface BackfillSourceMetadata {
  type: "backfill_anchor";
  parentNodeId: string;
  targetMessageId: string;
  targetMessageRole: Role;
  targetMessageCreatedAt: string;
  baseMessageContentHash: string;
  baseContentLength: number;
  coordinateSpace: "raw_markdown";
  selectorStrategy: "dom_to_raw_exact";
  anchorRangeStart: number;
  anchorRangeEnd: number;
  anchorText: string;
  anchorPrefix: string;
  anchorSuffix: string;
  beforeContext: string;
  afterContext: string;
}

export interface UploadedFile {
  id: string;
  nodeId: string;
  notebookId: string;
  filename: string;
  originalFilename: string;
  mimeType?: string | null;
  fileSize: number;
  extractionStatus: "pending" | "ready" | "failed";
  extractedChars: number;
  errorMessage?: string | null;
  createdAt: string;
  updatedAt: string;
  localFile?: File;
}
