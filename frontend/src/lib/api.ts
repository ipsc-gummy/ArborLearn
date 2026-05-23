import type { ChatMessage, ConversationPatch, EditType, KnowledgeNode } from "../types/treelearn";
import type { DeepSeekModelId, DeepSeekThinkingModeId } from "./models";

const DEFAULT_API_BASE_URL = import.meta.env.DEV ? "http://127.0.0.1:8000" : "";
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? DEFAULT_API_BASE_URL).replace(/\/$/, "");
const TOKEN_KEY = "arborlearn.authToken";

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
}

interface AuthResponse {
  token: string;
  user: AuthUser;
}

interface TreeStateResponse {
  nodes: Record<string, KnowledgeNode>;
  rootIds: string[];
  pinnedRootIds: string[];
}

interface ChatResponse {
  messageId: string;
  role: "assistant";
  content: string;
  createdAt: string;
  nodeId?: string;
  nodeTitle?: string | null;
  nodeSummary?: string | null;
  userMessage?: ChatMessage;
  message?: ChatMessage;
  sources?: Array<{ title?: string; url?: string }>;
}

interface ChatStreamCallbacks {
  onDelta: (delta: string) => void;
  onDone: (response: ChatResponse) => void;
}

export interface LongTaskStep {
  id: string;
  task_id: string;
  node_id?: string | null;
  step_index: number;
  title: string;
  goal: string;
  step_type: string;
  status: "PENDING" | "RUNNING" | "DONE" | "FAILED" | "SKIPPED";
  need_retrieval: boolean;
  retrieval_mode: string;
  output_summary?: string | null;
  error_message?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
}

export interface TaskEvidence {
  id: string;
  source_type: string;
  source_id?: string | null;
  title?: string | null;
  url?: string | null;
  evidence_text: string;
  relevance_score?: number | null;
  char_count?: number | null;
  created_at?: string;
}

export interface StepOutput {
  id: string;
  output_type: string;
  content: string;
  summary?: string | null;
  confidence?: number | null;
  unresolved_questions?: string | null;
  created_at?: string;
}

export interface LongTask {
  id: string;
  title?: string | null;
  original_question: string;
  status: "CREATED" | "PLANNING" | "RUNNING" | "SUMMARIZING" | "DONE" | "FAILED" | "CANCELLED";
  current_step_index: number;
  plan_summary?: string | null;
  node_id?: string | null;
  notebook_id?: string | null;
  model_name?: DeepSeekModelId | null;
  thinking_mode?: DeepSeekThinkingModeId | null;
  final_answer?: string | null;
  error_message?: string | null;
  created_at?: string;
  updated_at?: string;
  finished_at?: string | null;
  steps?: LongTaskStep[];
}

export interface LongTaskStepDetail extends LongTaskStep {
  evidence: TaskEvidence[];
  outputs: StepOutput[];
}

export interface ContextDebugResponse {
  node_id: string;
  model_config: {
    model?: DeepSeekModelId | string | null;
    thinkingMode?: DeepSeekThinkingModeId | string | null;
  };
  sections: Array<{ name: string; chars: number; truncated?: boolean }>;
  sources: Array<{
    title?: string | null;
    url?: string | null;
    source_type?: string | null;
    trust_level?: string | null;
    evidence_preview?: string | null;
  }>;
  estimated_tokens: number;
  truncated: boolean;
  web_search_warning?: string | null;
  final_context_preview: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getAuthToken();
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
    ...init,
  });

  if (!response.ok) {
    let detail = response.statusText;
    try {
      const body = await response.json();
      detail = body.detail ?? detail;
    } catch {
      // Keep the HTTP status text when the backend does not return JSON.
    }
    throw new Error(detail);
  }

  return response.json() as Promise<T>;
}

export function getAuthToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setAuthToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearAuthToken() {
  localStorage.removeItem(TOKEN_KEY);
}

export function register(payload: { email: string; password: string; displayName?: string }) {
  return request<AuthResponse>("/api/auth/register", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function login(payload: { email: string; password: string }) {
  return request<AuthResponse>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function fetchMe() {
  return request<{ user: AuthUser }>("/api/auth/me");
}

export function fetchTreeState() {
  return request<TreeStateResponse>("/api/tree");
}

export function createBackendNode(node: KnowledgeNode, notebookId?: string) {
  return request<{ id: string; notebookId: string }>("/api/nodes", {
    method: "POST",
    body: JSON.stringify({
      id: node.id,
      notebookId,
      parentId: node.parentId,
      title: node.title,
      summary: node.summary,
      selectedText: node.selectedText,
      contextWeight: node.contextWeight,
      sourceMetadata: node.sourceMetadata,
      messages: node.messages,
    }),
  });
}

export function createBackfillPatch(payload: {
  sourceChildNodeId: string;
  targetMessageId: string;
  editType: EditType;
  targetRangeStart: number;
  targetRangeEnd: number;
  replacementText: string;
}) {
  return request<{ patch: ConversationPatch }>("/api/backfill/patches", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function archiveBackfillPatch(patchId: string) {
  return request<{ patch: ConversationPatch }>(`/api/backfill/patches/${patchId}/archive`, {
    method: "POST",
  });
}

export function patchBackendNode(
  nodeId: string,
  patch: Partial<Pick<KnowledgeNode, "title" | "summary" | "selectedText" | "contextWeight" | "parentId">>,
) {
  return request<{ ok: true }>(`/api/nodes/${nodeId}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function deleteBackendNode(nodeId: string) {
  return request<{ ok: true }>(`/api/nodes/${nodeId}`, {
    method: "DELETE",
  });
}

export function createLongTask(payload: {
  node_id?: string;
  notebook_id?: string;
  question: string;
  title?: string;
  auto_run?: boolean;
  model?: DeepSeekModelId;
  thinkingMode?: DeepSeekThinkingModeId;
}) {
  return request<{
    id: string;
    status: string;
    title?: string | null;
    original_question: string;
    node_id?: string | null;
    model_name?: DeepSeekModelId | null;
    thinking_mode?: DeepSeekThinkingModeId | null;
  }>(
    "/api/long-tasks",
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
}

export function runLongTask(taskId: string) {
  return request<{ task_id: string; status: string; message: string }>(`/api/long-tasks/${taskId}/run`, {
    method: "POST",
  });
}

export function fetchLongTask(taskId: string) {
  return request<LongTask>(`/api/long-tasks/${taskId}`);
}

export function fetchLongTaskStep(taskId: string, stepId: string) {
  return request<LongTaskStepDetail>(`/api/long-tasks/${taskId}/steps/${stepId}`);
}

export function cancelLongTask(taskId: string) {
  return request<{ task_id: string; status: string }>(`/api/long-tasks/${taskId}/cancel`, {
    method: "POST",
  });
}

export function fetchContextDebug(payload: {
  nodeId: string;
  query?: string;
  webSearch?: boolean;
  modelName?: DeepSeekModelId;
  thinkingMode?: DeepSeekThinkingModeId;
}) {
  const params = new URLSearchParams({ node_id: payload.nodeId });
  if (payload.query) params.set("query", payload.query);
  if (payload.webSearch) params.set("webSearch", "true");
  if (payload.modelName) params.set("modelName", payload.modelName);
  if (payload.thinkingMode) params.set("thinkingMode", payload.thinkingMode);
  return request<ContextDebugResponse>(`/api/context/debug?${params.toString()}`);
}

export function postChat(payload: {
  notebookId: string;
  nodeId: string;
  message: string;
  userMessageId: string;
  assistantMessageId?: string;
  modelName?: DeepSeekModelId;
  thinkingMode?: DeepSeekThinkingModeId;
  webSearch?: boolean;
  webQuery?: string;
}) {
  return request<ChatResponse>("/api/chat", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function postStoppedChat(payload: {
  nodeId: string;
  content: string;
  assistantMessageId: string;
}) {
  return request<{ message: ChatMessage | null }>("/api/chat/stop", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function postChatRetry(payload: {
  nodeId: string;
  assistantMessageId: string;
  modelName?: DeepSeekModelId;
  thinkingMode?: DeepSeekThinkingModeId;
}) {
  return request<ChatResponse>("/api/chat/retry", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function postChatRetryStream(
  payload: {
    nodeId: string;
    assistantMessageId: string;
    modelName?: DeepSeekModelId;
    thinkingMode?: DeepSeekThinkingModeId;
  },
  callbacks: ChatStreamCallbacks,
  signal?: AbortSignal,
) {
  const token = getAuthToken();
  const response = await fetch(`${API_BASE_URL}/api/chat/retry/stream`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(payload),
    signal,
  });

  if (!response.ok) {
    let detail = response.statusText;
    try {
      const body = await response.json();
      detail = body.detail ?? detail;
    } catch {
      // Keep status text when the backend returns plain text.
    }
    throw new Error(detail);
  }

  if (!response.body) {
    throw new Error("模型流式响应为空");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split(/\n\n|\r\n\r\n/);
    buffer = frames.pop() ?? "";
    frames.forEach((frame) => applySseFrame(frame, callbacks));
  }

  if (buffer.trim()) {
    applySseFrame(buffer, callbacks);
  }
}

function applySseFrame(frame: string, callbacks: ChatStreamCallbacks) {
  const lines = frame.split(/\r?\n/);
  const eventName = lines.find((line) => line.startsWith("event:"))?.slice(6).trim() || "message";
  const data = lines
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .join("\n");

  if (!data) return;
  const payload = JSON.parse(data);
  if (eventName === "error") {
    throw new Error(payload?.error ?? "模型调用失败");
  }
  if (eventName === "done") {
    callbacks.onDone(payload as ChatResponse);
    return;
  }
  if (payload?.content) {
    callbacks.onDelta(String(payload.content));
  }
}

export async function postChatStream(
  payload: {
    notebookId: string;
    nodeId: string;
    message: string;
    userMessageId: string;
    assistantMessageId?: string;
    modelName?: DeepSeekModelId;
    thinkingMode?: DeepSeekThinkingModeId;
    webSearch?: boolean;
    webQuery?: string;
  },
  callbacks: ChatStreamCallbacks,
  signal?: AbortSignal,
) {
  const token = getAuthToken();
  const response = await fetch(`${API_BASE_URL}/api/chat/stream`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(payload),
    signal,
  });

  if (!response.ok) {
    let detail = response.statusText;
    try {
      const body = await response.json();
      detail = body.detail ?? detail;
    } catch {
      // Keep status text when the backend returns plain text.
    }
    throw new Error(detail);
  }

  if (!response.body) {
    throw new Error("模型流式响应为空");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split(/\n\n|\r\n\r\n/);
    buffer = frames.pop() ?? "";
    frames.forEach((frame) => applySseFrame(frame, callbacks));
  }

  if (buffer.trim()) {
    applySseFrame(buffer, callbacks);
  }
}
