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
  message?: ChatMessage;
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
}) {
  return request<ChatResponse>("/api/chat", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
