import type { ChatMessage, KnowledgeNode } from "../types/treelearn";

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
}

interface ChatStreamCallbacks {
  onDelta: (delta: string) => void;
  onDone: (response: ChatResponse) => void;
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
      messages: node.messages,
    }),
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

export function postChat(payload: {
  notebookId: string;
  nodeId: string;
  message: string;
  userMessageId: string;
  assistantMessageId?: string;
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
