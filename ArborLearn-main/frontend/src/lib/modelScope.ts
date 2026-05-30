import {
  DEFAULT_DEEPSEEK_MODEL_ID,
  DEFAULT_DEEPSEEK_THINKING_MODE_ID,
  type DeepSeekModelId,
  type DeepSeekThinkingModeId,
} from "./models";

export interface ModelConfig {
  model: DeepSeekModelId;
  thinkingMode: DeepSeekThinkingModeId;
}

export interface ModelScope {
  panelId?: string;
  threadId?: string;
  nodeId?: string;
  notebookId?: string;
  taskId?: string;
}

export const GLOBAL_MODEL_SCOPE_ID = "global:default";

export const GLOBAL_DEFAULT_MODEL_CONFIG: ModelConfig = {
  model: DEFAULT_DEEPSEEK_MODEL_ID,
  thinkingMode: DEFAULT_DEEPSEEK_THINKING_MODE_ID,
};

export function getModelScopeId(params: ModelScope): string {
  if (params.taskId) return `task:${params.taskId}`;
  if (params.panelId) return `panel:${params.panelId}`;
  if (params.threadId) return `thread:${params.threadId}`;
  if (params.nodeId) return `node:${params.nodeId}`;
  if (params.notebookId) return `notebook:${params.notebookId}`;
  return GLOBAL_MODEL_SCOPE_ID;
}

export function getModelScopeFallbackIds(params: ModelScope): string[] {
  const ids: string[] = [];
  if (params.taskId) ids.push(`task:${params.taskId}`);
  if (params.panelId) ids.push(`panel:${params.panelId}`);
  if (params.threadId) ids.push(`thread:${params.threadId}`);
  if (params.nodeId) ids.push(`node:${params.nodeId}`);
  if (params.notebookId) ids.push(`notebook:${params.notebookId}`);
  ids.push(GLOBAL_MODEL_SCOPE_ID);
  return Array.from(new Set(ids));
}
