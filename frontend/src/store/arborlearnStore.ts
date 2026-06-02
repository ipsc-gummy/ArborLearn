import { create } from "zustand";
import { seedSkills } from "../data/seed";
import {
  clearAuthToken,
  createBackendNode,
  createDemoSession as createDemoSessionRequest,
  deleteBackendNode,
  deleteUploadedFile as deleteUploadedFileRequest,
  fetchNodeFiles,
  fetchMe,
  fetchTreeState,
  getAuthToken,
  login as loginRequest,
  patchBackendNode,
  postChat,
  postChatRetryStream,
  postChatStream,
  postStoppedChat,
  register as registerRequest,
  resumeDemoNotebook as resumeDemoNotebookRequest,
  setAuthToken,
  type AuthUser,
  uploadNodeFile,
} from "../lib/api";
import type { BackfillSourceMetadata, ChatMessage, KnowledgeNode, SelectionDraft, SkillTemplate, UploadedFile } from "../types/arborlearn";
import { uid } from "../lib/utils";
import {
  DEFAULT_DEEPSEEK_MODEL_ID,
  DEFAULT_DEEPSEEK_THINKING_MODE_ID,
  isDeepSeekModelId,
  isDeepSeekThinkingModeId,
  type DeepSeekModelId,
  type DeepSeekThinkingModeId,
} from "../lib/models";
import {
  GLOBAL_MODEL_SCOPE_ID,
  getModelScopeFallbackIds,
  type ModelConfig,
  type ModelScope,
} from "../lib/modelScope";

type ChatRunStatus = "thinking" | "streaming";
const activeChatControllers = new Map<string, AbortController>();
const CHAT_STREAM_TIMEOUT_MS = 90_000;
const LAST_LOCATION_KEY = "arborlearn.lastLocation";
const MODEL_SELECTION_KEY = "arborlearn.modelSelection.v2";
const THINKING_MODE_SELECTION_KEY = "arborlearn.thinkingModeSelection";
const MODEL_CONFIGS_BY_SCOPE_KEY = "arborlearn:model-configs:v2";
const WEB_SEARCH_ENABLED_BY_NODE_KEY = "arborlearn.webSearchEnabledByNode";
const IMAGE_FILE_EXTENSIONS = /\.(png|jpe?g|webp|bmp)$/i;

function isImageUploadFile(file: File) {
  return file.type.startsWith("image/") || IMAGE_FILE_EXTENSIONS.test(file.name);
}

function attachLocalFiles(nextFiles: UploadedFile[], previousFiles: UploadedFile[] = []) {
  const localFilesById = new Map(
    previousFiles
      .filter((file) => file.localFile)
      .map((file) => [file.id, file.localFile as File]),
  );
  return nextFiles.map((file) => {
    const localFile = localFilesById.get(file.id);
    return localFile ? { ...file, localFile } : file;
  });
}

function syncMessageAttachmentsWithFiles(
  nodes: Record<string, KnowledgeNode>,
  nodeId: string,
  files: UploadedFile[],
) {
  const node = nodes[nodeId];
  if (!node || files.length === 0) return nodes;

  const filesById = new Map(files.map((file) => [file.id, file]));
  let changed = false;
  const messages = node.messages.map((message) => {
    if (!message.attachments?.length) return message;
    let messageChanged = false;
    const attachments = message.attachments.map((attachment) => {
      const latestFile = filesById.get(attachment.id);
      if (!latestFile) return attachment;
      messageChanged = true;
      return {
        ...attachment,
        filename: latestFile.filename,
        mimeType: latestFile.mimeType,
        fileSize: latestFile.fileSize,
        extractionStatus: latestFile.extractionStatus,
        errorMessage: latestFile.errorMessage,
        localFile: attachment.localFile ?? latestFile.localFile,
      };
    });
    if (!messageChanged) return message;
    changed = true;
    return { ...message, attachments };
  });

  if (!changed) return nodes;
  return {
    ...nodes,
    [nodeId]: { ...node, messages },
  };
}

// 全局状态集中放在 Zustand：组件只订阅自己需要的字段，避免层层传 props。
interface ArborLearnState {
  // nodes 是扁平字典，便于按 id 快速读取、重命名、移动和删除。
  nodes: Record<string, KnowledgeNode>;
  // rootIds 记录所有笔记本根节点；pinnedRootIds 只保存被置顶的根节点 id。
  rootIds: string[];
  pinnedRootIds: string[];
  // activeNodeId 决定右侧聊天面板展示哪个节点；compareNodeId 决定是否显示父子 3:7 分屏。
  activeNodeId: string;
  compareNodeId: string | null;
  sidebarOpen: boolean;
  apiStatus: "idle" | "loading" | "ready" | "error";
  apiError: string | null;
  authStatus: "checking" | "authenticated" | "anonymous" | "error";
  authError: string | null;
  user: AuthUser | null;
  selectedModel: DeepSeekModelId;
  selectedThinkingMode: DeepSeekThinkingModeId;
  configsByScope: Record<string, ModelConfig>;
  webSearchEnabledByNode: Record<string, boolean>;
  chatRunStatusByNode: Record<string, ChatRunStatus>;
  filesByNode: Record<string, UploadedFile[]>;
  fileUploadStatusByNode: Record<string, "uploading">;
  // selectionDraft 存放用户划选文本后的临时悬浮条数据。
  selectionDraft: SelectionDraft | null;
  skills: SkillTemplate[];
  initializeAuth: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName?: string) => Promise<void>;
  createDemoSession: () => Promise<void>;
  resumeDemoNotebook: (notebookRef: string) => Promise<void>;
  logout: () => void;
  hydrateFromBackend: () => Promise<void>;
  createRootConversation: () => string;
  createChildNodeUnderActive: () => string;
  setActiveNode: (nodeId: string) => void;
  closeChildConversation: () => void;
  toggleSidebar: () => void;
  toggleNode: (nodeId: string) => void;
  setSelectionDraft: (draft: SelectionDraft | null) => void;
  getModelConfig: (scope: ModelScope) => ModelConfig;
  setModelConfig: (scopeId: string, config: ModelConfig) => void;
  setSelectedModel: (scopeId: string, modelName: DeepSeekModelId) => void;
  setSelectedThinkingMode: (scopeId: string, thinkingMode: DeepSeekThinkingModeId) => void;
  createChildConversation: (sourceNodeId: string, selectedText: string, sourceMetadata?: BackfillSourceMetadata) => string;
  setWebSearchEnabled: (nodeId: string, enabled: boolean) => void;
  loadNodeFiles: (nodeId: string, options?: { force?: boolean }) => Promise<void>;
  uploadFile: (nodeId: string, file: File) => Promise<void>;
  deleteFile: (fileId: string, nodeId: string) => Promise<void>;
  appendMessage: (
    nodeId: string,
    content: string,
    modelScope?: ModelScope,
    attachments?: Array<{
      id: string;
      filename: string;
      mimeType?: string | null;
      fileSize: number;
      extractionStatus: "pending" | "ready" | "failed";
      errorMessage?: string | null;
      localFile?: File;
    }>,
  ) => void;
  retryAssistantMessage: (nodeId: string, assistantMessageId: string) => void;
  stopMessage: (nodeId: string) => void;
  renameNode: (nodeId: string, title: string) => void;
  togglePinRoot: (nodeId: string) => void;
  deleteNode: (nodeId: string) => void;
  moveNode: (nodeId: string, targetParentId: string) => void;
  toggleSkill: (skillId: string) => void;
}

// 递归收集某节点及其所有后代，删除节点时保证整棵子树一起清理。
function collectDescendantIds(nodes: Record<string, KnowledgeNode>, nodeId: string) {
  const ids = [nodeId];
  nodes[nodeId]?.children.forEach((childId) => {
    ids.push(...collectDescendantIds(nodes, childId));
  });
  return ids;
}

// 创建主节点或子节点的公共工厂，保证新节点结构和默认 system 消息一致。
function createNode(parentId: string | null, title: string, summary: string): KnowledgeNode {
  const now = new Date().toISOString();
  return {
    id: uid("node"),
    parentId,
    title,
    kind: parentId ? "branch" : "main",
    summary,
    contextWeight: parentId ? "isolated" : "mainline",
    children: [],
    expanded: true,
    updatedAt: now,
    messages: [
      {
        id: uid("msg"),
        role: "system",
        createdAt: now,
        content: parentId
          ? "已添加新的子对话节点。后端接入后，这里应创建父子节点关系并初始化上下文摘要。"
          : "已创建新的主对话。后端接入后，这里应同步创建一个根知识节点。",
      },
    ],
  };
}

function getNotebookRootId(nodes: Record<string, KnowledgeNode>, nodeId: string) {
  let current = nodes[nodeId];
  const seen = new Set<string>();
  while (current?.parentId && !seen.has(current.id)) {
    seen.add(current.id);
    current = nodes[current.parentId];
  }
  return current?.id ?? nodeId;
}

function touchNotebookRoot(nodes: Record<string, KnowledgeNode>, nodeId: string, updatedAt: string) {
  const rootId = getNotebookRootId(nodes, nodeId);
  if (!nodes[rootId] || rootId === nodeId) return nodes;
  return {
    ...nodes,
    [rootId]: { ...nodes[rootId], updatedAt },
  };
}

function isDescendantOf(nodes: Record<string, KnowledgeNode>, nodeId: string, candidateParentId: string): boolean {
  const children = nodes[nodeId]?.children ?? [];
  if (children.includes(candidateParentId)) return true;
  return children.some((childId) => isDescendantOf(nodes, childId, candidateParentId));
}

function getSavedActiveNodeId(nodes: Record<string, KnowledgeNode>) {
  try {
    const saved = JSON.parse(localStorage.getItem(LAST_LOCATION_KEY) || "{}") as {
      screen?: string;
      activeNodeId?: string;
    };
    return saved.screen === "workspace" && saved.activeNodeId && nodes[saved.activeNodeId] ? saved.activeNodeId : null;
  } catch {
    return null;
  }
}

function getStoredModelSelection(): DeepSeekModelId {
  try {
    const saved = localStorage.getItem(MODEL_SELECTION_KEY);
    return isDeepSeekModelId(saved) ? saved : DEFAULT_DEEPSEEK_MODEL_ID;
  } catch {
    return DEFAULT_DEEPSEEK_MODEL_ID;
  }
}

function saveModelSelection(modelName: DeepSeekModelId) {
  try {
    localStorage.setItem(MODEL_SELECTION_KEY, modelName);
  } catch {
    // Ignore storage failures; the in-memory selection still applies.
  }
}

function getStoredThinkingModeSelection(): DeepSeekThinkingModeId {
  try {
    const saved = localStorage.getItem(THINKING_MODE_SELECTION_KEY);
    return isDeepSeekThinkingModeId(saved) ? saved : DEFAULT_DEEPSEEK_THINKING_MODE_ID;
  } catch {
    return DEFAULT_DEEPSEEK_THINKING_MODE_ID;
  }
}

function saveThinkingModeSelection(thinkingMode: DeepSeekThinkingModeId) {
  try {
    localStorage.setItem(THINKING_MODE_SELECTION_KEY, thinkingMode);
  } catch {
    // Ignore storage failures; the in-memory selection still applies.
  }
}

function isModelConfig(value: unknown): value is ModelConfig {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ModelConfig>;
  return isDeepSeekModelId(candidate.model) && isDeepSeekThinkingModeId(candidate.thinkingMode);
}

function getStoredModelConfigsByScope(): Record<string, ModelConfig> {
  const fallbackConfig: ModelConfig = {
    model: DEFAULT_DEEPSEEK_MODEL_ID,
    thinkingMode: DEFAULT_DEEPSEEK_THINKING_MODE_ID,
  };
  try {
    const parsed = JSON.parse(localStorage.getItem(MODEL_CONFIGS_BY_SCOPE_KEY) || "{}") as Record<string, unknown>;
    const configs: Record<string, ModelConfig> = {};
    Object.entries(parsed).forEach(([scopeId, value]) => {
      if (scopeId.startsWith("task:")) return;
      if (isModelConfig(value)) configs[scopeId] = value;
    });
    return { [GLOBAL_MODEL_SCOPE_ID]: configs[GLOBAL_MODEL_SCOPE_ID] ?? fallbackConfig, ...configs };
  } catch {
    return { [GLOBAL_MODEL_SCOPE_ID]: fallbackConfig };
  }
}

function saveModelConfigsByScope(configs: Record<string, ModelConfig>) {
  try {
    const persistent = Object.fromEntries(Object.entries(configs).filter(([scopeId]) => !scopeId.startsWith("task:")));
    localStorage.setItem(MODEL_CONFIGS_BY_SCOPE_KEY, JSON.stringify(persistent));
  } catch {
    // Ignore storage failures; the in-memory selection still applies.
  }
}

function getStoredWebSearchEnabledByNode(): Record<string, boolean> {
  try {
    const saved = localStorage.getItem(WEB_SEARCH_ENABLED_BY_NODE_KEY);
    if (!saved) return {};
    const parsed = JSON.parse(saved) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(parsed).filter(([, value]) => typeof value === "boolean")) as Record<string, boolean>;
  } catch {
    // Ignore storage failures; the in-memory default still applies.
    return {};
  }
}

function saveWebSearchEnabledByNode(settings: Record<string, boolean>) {
  try {
    localStorage.setItem(WEB_SEARCH_ENABLED_BY_NODE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore storage failures; the in-memory toggle still applies.
  }
}

export const useArborLearnStore = create<ArborLearnState>((set, get) => ({
  nodes: {},
  rootIds: [],
  pinnedRootIds: [],
  activeNodeId: "",
  compareNodeId: null,
  sidebarOpen: true,
  apiStatus: "idle",
  apiError: null,
  authStatus: "checking",
  authError: null,
  user: null,
  selectedModel: getStoredModelSelection(),
  selectedThinkingMode: getStoredThinkingModeSelection(),
  configsByScope: getStoredModelConfigsByScope(),
  webSearchEnabledByNode: getStoredWebSearchEnabledByNode(),
  chatRunStatusByNode: {},
  filesByNode: {},
  fileUploadStatusByNode: {},
  selectionDraft: null,
  skills: seedSkills,
  initializeAuth: async () => {
    if (!getAuthToken()) {
      set({ authStatus: "anonymous", user: null, nodes: {}, rootIds: [], pinnedRootIds: [], activeNodeId: "", filesByNode: {} });
      return;
    }

    set({ authStatus: "checking", authError: null });
    try {
      const response = await fetchMe();
      set({ user: response.user, authStatus: "authenticated", authError: null });
      await get().hydrateFromBackend();
    } catch (error) {
      clearAuthToken();
      set({
        authStatus: "anonymous",
        authError: error instanceof Error ? error.message : "登录状态已失效",
        user: null,
        nodes: {},
        rootIds: [],
        pinnedRootIds: [],
        activeNodeId: "",
        filesByNode: {},
      });
    }
  },
  login: async (email, password) => {
    set({ authStatus: "checking", authError: null });
    try {
      const response = await loginRequest({ email, password });
      setAuthToken(response.token);
      set({ user: response.user, authStatus: "authenticated", authError: null });
      await get().hydrateFromBackend();
    } catch (error) {
      clearAuthToken();
      set({
        authStatus: "error",
        authError: error instanceof Error ? error.message : "登录失败",
        user: null,
      });
      throw error;
    }
  },
  register: async (email, password, displayName) => {
    set({ authStatus: "checking", authError: null });
    try {
      const response = await registerRequest({ email, password, displayName });
      setAuthToken(response.token);
      set({ user: response.user, authStatus: "authenticated", authError: null });
      await get().hydrateFromBackend();
    } catch (error) {
      clearAuthToken();
      set({
        authStatus: "error",
        authError: error instanceof Error ? error.message : "注册失败",
        user: null,
      });
      throw error;
    }
  },
  createDemoSession: async () => {
    set({ authStatus: "checking", authError: null });
    try {
      const response = await createDemoSessionRequest();
      setAuthToken(response.token, { persist: false });
      set({ user: response.user, authStatus: "authenticated", authError: null });
      await get().hydrateFromBackend();
    } catch (error) {
      clearAuthToken();
      set({
        authStatus: "error",
        authError: error instanceof Error ? error.message : "进入演示失败",
        user: null,
      });
      throw error;
    }
  },
  resumeDemoNotebook: async (notebookRef) => {
    set({ authStatus: "checking", authError: null });
    try {
      const response = await resumeDemoNotebookRequest(notebookRef);
      setAuthToken(response.token, { persist: false });
      set({ user: response.user, authStatus: "authenticated", authError: null });
      await get().hydrateFromBackend();
    } catch (error) {
      clearAuthToken();
      set({
        authStatus: "anonymous",
        authError: error instanceof Error ? error.message : "试用笔记本会话已失效",
        user: null,
      });
      throw error;
    }
  },
  logout: () => {
    clearAuthToken();
    activeChatControllers.forEach((controller) => controller.abort());
    activeChatControllers.clear();
    set({
      user: null,
      authStatus: "anonymous",
      authError: null,
      nodes: {},
      rootIds: [],
      pinnedRootIds: [],
      chatRunStatusByNode: {},
      filesByNode: {},
      fileUploadStatusByNode: {},
      activeNodeId: "",
      compareNodeId: null,
      selectionDraft: null,
    });
  },
  hydrateFromBackend: async () => {
    if (!getAuthToken()) {
      set({ apiStatus: "idle", apiError: null });
      return;
    }
    set({ apiStatus: "loading", apiError: null });
    try {
      const state = await fetchTreeState();
      const previousActiveNodeId = get().activeNodeId;
      const activeNodeId =
        (previousActiveNodeId && state.nodes[previousActiveNodeId] ? previousActiveNodeId : null) ??
        getSavedActiveNodeId(state.nodes) ??
        state.rootIds[0] ??
        "";
      set({
        nodes: state.nodes,
        rootIds: state.rootIds,
        pinnedRootIds: state.pinnedRootIds,
        filesByNode: {},
        activeNodeId,
        compareNodeId: null,
        selectionDraft: null,
        apiStatus: "ready",
        apiError: null,
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes("Authentication")) {
        clearAuthToken();
        set({ authStatus: "anonymous", user: null, nodes: {}, rootIds: [], pinnedRootIds: [], activeNodeId: "", filesByNode: {} });
      }
      set({ apiStatus: "error", apiError: error instanceof Error ? error.message : "无法连接 ArborLearn API" });
    }
  },
  createRootConversation: () => {
    // 创建新的根节点并放到首页列表最前面，模拟“新建笔记本”体验。
    const newNode = createNode(null, "新的学习主题", "从这里开始导入资料或输入问题，构建新的树形学习路径。");
    set((state) => ({
      nodes: { ...state.nodes, [newNode.id]: newNode },
      rootIds: [newNode.id, ...state.rootIds],
      activeNodeId: newNode.id,
      compareNodeId: null,
      selectionDraft: null,
    }));

    void createBackendNode(newNode, newNode.id).catch((error) => {
      set({ apiStatus: "error", apiError: error instanceof Error ? error.message : "创建笔记本失败" });
    });
    return newNode.id;
  },
  createChildNodeUnderActive: () => {
    // “添加对话节点”默认挂到当前活动节点下，并切换到新节点继续编辑。
    const state = get();
    const parentId = state.activeNodeId;
    const parent = state.nodes[parentId];
    const newNode = createNode(parentId, "新的对话节点", `“${parent?.title ?? "当前节点"}”下的新子节点。`);

    const now = newNode.updatedAt;

    set((current) => ({
      nodes: touchNotebookRoot({
        ...current.nodes,
        [parentId]: {
          ...current.nodes[parentId],
          children: [...current.nodes[parentId].children, newNode.id],
          expanded: true,
          updatedAt: now,
        },
        [newNode.id]: newNode,
      }, parentId, now),
      activeNodeId: newNode.id,
      compareNodeId: parentId,
      selectionDraft: null,
    }));

    void createBackendNode(newNode, getNotebookRootId(state.nodes, parentId)).catch((error) => {
      set({ apiStatus: "error", apiError: error instanceof Error ? error.message : "创建子节点失败" });
    });
    return newNode.id;
  },
  setActiveNode: (nodeId) =>
    set((state) => ({
      // 切换节点时顺手更新 compareNodeId：有父节点就进入父子对照模式。
      activeNodeId: nodeId,
      compareNodeId: state.nodes[nodeId]?.parentId ?? null,
      selectionDraft: null,
    })),
  closeChildConversation: () =>
    set((state) => {
      // 关闭子对话等价于回到父节点；若当前已是根节点，只清空对照状态。
      const parentId = state.nodes[state.activeNodeId]?.parentId;
      if (!parentId) return { compareNodeId: null, selectionDraft: null };
      return { activeNodeId: parentId, compareNodeId: null, selectionDraft: null };
    }),
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  toggleNode: (nodeId) =>
    set((state) => ({
      nodes: {
        ...state.nodes,
        [nodeId]: { ...state.nodes[nodeId], expanded: !state.nodes[nodeId].expanded },
      },
    })),
  setSelectionDraft: (draft) => set({ selectionDraft: draft }),
  getModelConfig: (scope) => {
    const state = get();
    for (const scopeId of getModelScopeFallbackIds(scope)) {
      const config = state.configsByScope[scopeId];
      if (config) return config;
    }
    return state.configsByScope[GLOBAL_MODEL_SCOPE_ID] ?? {
      model: state.selectedModel,
      thinkingMode: state.selectedThinkingMode,
    };
  },
  setModelConfig: (scopeId, config) => {
    set((current) => ({
      configsByScope: { ...current.configsByScope, [scopeId]: config },
    }));
    saveModelConfigsByScope({ ...get().configsByScope, [scopeId]: config });
  },
  setSelectedModel: (scopeId, modelName) => {
    const currentConfig = get().configsByScope[scopeId] ?? get().getModelConfig({});
    get().setModelConfig(scopeId, { ...currentConfig, model: modelName });
  },
  setSelectedThinkingMode: (scopeId, thinkingMode) => {
    const currentConfig = get().configsByScope[scopeId] ?? get().getModelConfig({});
    get().setModelConfig(scopeId, { ...currentConfig, thinkingMode });
  },
  setWebSearchEnabled: (nodeId, enabled) => {
    const nextSettings = { ...get().webSearchEnabledByNode, [nodeId]: enabled };
    saveWebSearchEnabledByNode(nextSettings);
    set({ webSearchEnabledByNode: nextSettings });
  },
  loadNodeFiles: async (nodeId, options) => {
    if (!options?.force && get().filesByNode[nodeId]) return;
    try {
      const response = await fetchNodeFiles(nodeId);
      set((state) => {
        const nextFiles = attachLocalFiles(response.files, state.filesByNode[nodeId]);
        return {
          nodes: syncMessageAttachmentsWithFiles(state.nodes, nodeId, nextFiles),
          apiStatus: state.apiStatus === "error" ? "ready" : state.apiStatus,
          apiError: state.apiStatus === "error" ? null : state.apiError,
          filesByNode: {
            ...state.filesByNode,
            [nodeId]: nextFiles,
          },
        };
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "加载附件失败";
      if (message.includes("Node not found")) {
        set((state) => ({
          filesByNode: { ...state.filesByNode, [nodeId]: state.filesByNode[nodeId] ?? [] },
        }));
        return;
      }
      set({ apiStatus: "error", apiError: error instanceof Error ? error.message : "加载附件失败" });
    }
  },
  uploadFile: async (nodeId, file) => {
    const now = new Date().toISOString();
    const optimisticFile: UploadedFile = {
      id: uid("local-file"),
      nodeId,
      notebookId: getNotebookRootId(get().nodes, nodeId),
      filename: file.name || "upload",
      originalFilename: file.name || "upload",
      mimeType: file.type || null,
      fileSize: file.size,
      extractionStatus: "pending",
      extractedChars: 0,
      errorMessage: null,
      createdAt: now,
      updatedAt: now,
      localFile: isImageUploadFile(file) ? file : undefined,
    };
    set((state) => ({
      apiError: null,
      fileUploadStatusByNode: { ...state.fileUploadStatusByNode, [nodeId]: "uploading" },
      filesByNode: {
        ...state.filesByNode,
        [nodeId]: [optimisticFile, ...(state.filesByNode[nodeId] ?? [])],
      },
    }));
    try {
      const response = await uploadNodeFile(nodeId, file);
      set((state) => {
        const uploadedFile = { ...response.file, localFile: optimisticFile.localFile };
        const node = state.nodes[nodeId];
        const nodes = node
          ? {
              ...state.nodes,
              [nodeId]: {
                ...node,
                messages: node.messages.map((message) =>
                  message.attachments?.some((attachment) => attachment.id === optimisticFile.id)
                    ? {
                        ...message,
                        attachments: message.attachments.map((attachment) =>
                          attachment.id === optimisticFile.id
                            ? {
                                id: uploadedFile.id,
                                filename: uploadedFile.filename,
                                mimeType: uploadedFile.mimeType,
                                fileSize: uploadedFile.fileSize,
                                extractionStatus: uploadedFile.extractionStatus,
                                errorMessage: uploadedFile.errorMessage,
                                localFile: uploadedFile.localFile,
                              }
                            : attachment,
                        ),
                      }
                    : message,
                ),
              },
            }
          : state.nodes;
        return {
          nodes,
          apiStatus: "ready",
          apiError: null,
          filesByNode: {
            ...state.filesByNode,
            [nodeId]: [
              uploadedFile,
              ...(state.filesByNode[nodeId] ?? []).filter((item) => item.id !== optimisticFile.id && item.id !== response.file.id),
            ],
          },
        };
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "上传文件失败";
      set((state) => {
        const node = state.nodes[nodeId];
        const nodes = node
          ? {
              ...state.nodes,
              [nodeId]: {
                ...node,
                messages: node.messages.map((item) =>
                  item.attachments?.some((attachment) => attachment.id === optimisticFile.id)
                    ? {
                        ...item,
                        attachments: item.attachments.map((attachment) =>
                          attachment.id === optimisticFile.id
                            ? { ...attachment, extractionStatus: "failed" as const, errorMessage: message }
                            : attachment,
                        ),
                      }
                    : item,
                ),
              },
            }
          : state.nodes;
        return {
          nodes,
          apiStatus: "error",
          apiError: message,
          filesByNode: {
            ...state.filesByNode,
            [nodeId]: (state.filesByNode[nodeId] ?? []).filter((item) => item.id !== optimisticFile.id),
          },
        };
      });
      throw error;
    } finally {
      set((state) => {
        const { [nodeId]: _removed, ...nextStatuses } = state.fileUploadStatusByNode;
        return { fileUploadStatusByNode: nextStatuses };
      });
    }
  },
  deleteFile: async (fileId, nodeId) => {
    const previousFiles = get().filesByNode[nodeId] ?? [];
    set((state) => ({
      filesByNode: {
        ...state.filesByNode,
        [nodeId]: previousFiles.filter((file) => file.id !== fileId),
      },
    }));
    try {
      await deleteUploadedFileRequest(fileId);
    } catch (error) {
      set((state) => ({
        apiStatus: "error",
        apiError: error instanceof Error ? error.message : "删除附件失败",
        filesByNode: { ...state.filesByNode, [nodeId]: previousFiles },
      }));
    }
  },
  createChildConversation: (sourceNodeId, selectedText, sourceMetadata) => {
    // 从选中文本创建子对话：标题用片段截断生成，selectedText 用于后续高亮和上下文构造。
    const id = uid("node");
    const now = new Date().toISOString();
    const title = selectedText.length > 18 ? `${selectedText.slice(0, 18)}...` : selectedText;

    const newNode: KnowledgeNode = {
      id,
      parentId: sourceNodeId,
      title,
      kind: "branch",
      summary: "",
      selectedText,
      sourceMetadata: sourceMetadata ?? null,
      contextWeight: "isolated",
      children: [],
      expanded: true,
      updatedAt: now,
      messages: [
        {
          id: uid("msg"),
          role: "system",
          createdAt: now,
          selectedText,
          content:
            "已创建子对话。后端对接时，请使用 sourceNodeId、selectedText、路径摘要和启用的 Skill 构造局部上下文。",
        },
      ],
    };

    set((state) => ({
      nodes: touchNotebookRoot({
        ...state.nodes,
        [sourceNodeId]: {
          ...state.nodes[sourceNodeId],
          children: [...state.nodes[sourceNodeId].children, id],
          expanded: true,
          updatedAt: now,
        },
        [id]: newNode,
      }, sourceNodeId, now),
      activeNodeId: id,
      compareNodeId: sourceNodeId,
      selectionDraft: null,
    }));

    void createBackendNode(newNode, getNotebookRootId(get().nodes, sourceNodeId)).catch((error) => {
      set({ apiStatus: "error", apiError: error instanceof Error ? error.message : "创建子对话失败" });
    });
    return id;
  },
  appendMessage: (nodeId, content, modelScope, attachments) => {
    const state = get();
    if (state.chatRunStatusByNode[nodeId]) return;
    const useWebSearch = state.webSearchEnabledByNode[nodeId] ?? false;

    const now = new Date().toISOString();
    const notebookId = getNotebookRootId(state.nodes, nodeId);
    const modelConfig = state.getModelConfig({ nodeId, notebookId, threadId: nodeId, ...modelScope });
    const modelName = modelConfig.model;
    const thinkingMode = modelConfig.thinkingMode;
    const userMessage: ChatMessage = {
      id: uid("msg"),
      role: "user",
      content,
      createdAt: now,
      attachments: attachments?.length ? attachments : undefined,
    };
    const assistantMessageId = uid("msg");
    const controller = new AbortController();
    activeChatControllers.set(nodeId, controller);
    let streamTimedOut = false;
    const timeoutId = window.setTimeout(() => {
      streamTimedOut = true;
      controller.abort();
    }, CHAT_STREAM_TIMEOUT_MS);
    const assistantMessage: ChatMessage = {
      id: assistantMessageId,
      role: "assistant",
      content: useWebSearch ? "正在联网检索..." : "正在思考...",
      createdAt: now,
    };

    set((current) => ({
      nodes: touchNotebookRoot({
        ...current.nodes,
        [nodeId]: {
          ...current.nodes[nodeId],
          messages: [...current.nodes[nodeId].messages, userMessage, assistantMessage],
          updatedAt: now,
        },
      }, nodeId, now),
      apiError: null,
      chatRunStatusByNode: { ...current.chatRunStatusByNode, [nodeId]: "thinking" },
    }));

    let streamedContent = "";
    const clearRunStatus = () => {
      window.clearTimeout(timeoutId);
      activeChatControllers.delete(nodeId);
      set((current) => {
        const { [nodeId]: _removed, ...nextStatuses } = current.chatRunStatusByNode;
        return { chatRunStatusByNode: nextStatuses };
      });
    };

    void postChatStream(
      {
        notebookId,
        nodeId,
        message: content,
        userMessageId: userMessage.id,
        assistantMessageId,
        modelName,
        thinkingMode,
        webSearch: useWebSearch,
        ragEnabled: import.meta.env.VITE_RAG_ENABLED === "true",
      },
      {
        onDelta: (delta) => {
          streamedContent += delta;
          set((current) => {
            const node = current.nodes[nodeId];
            if (!node) return {};
            const updatedAt = new Date().toISOString();
            return {
              chatRunStatusByNode: { ...current.chatRunStatusByNode, [nodeId]: "streaming" },
              nodes: touchNotebookRoot({
                ...current.nodes,
                [nodeId]: {
                  ...node,
                  messages: node.messages.map((message) =>
                    message.id === assistantMessageId ? { ...message, content: streamedContent } : message,
                  ),
                  updatedAt,
                },
              }, nodeId, updatedAt),
            };
          });
        },
        onDone: (response) => {
          const finalAssistantMessage: ChatMessage = response.message ?? {
            id: response.messageId,
            role: response.role,
            content: response.content,
            createdAt: response.createdAt,
          };

          set((current) => {
            const node = current.nodes[nodeId];
            if (!node) return {};
            const nextTitle = response.nodeTitle?.trim();
            const nextSummary = response.nodeSummary?.trim();
            const updatedAt = finalAssistantMessage.createdAt;
            return {
              nodes: touchNotebookRoot({
                ...current.nodes,
                [nodeId]: {
                  ...node,
                  title: nextTitle || node.title,
                  summary: nextSummary || node.summary,
                  messages: node.messages.map((message) =>
                    message.id === assistantMessageId ? finalAssistantMessage : message,
                  ),
                  updatedAt,
                },
              }, nodeId, updatedAt),
              apiStatus: "ready",
              apiError: null,
            };
          });
        },
      },
      controller.signal,
    )
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          const stoppedAt = new Date().toISOString();
          const stoppedContent = streamedContent.trim();
          const timeoutMessage: ChatMessage = {
            id: uid("msg"),
            role: "system",
            content: "模型响应超时，请稍后重试，或切换到 Instant 模式后再发送。",
            createdAt: stoppedAt,
          };
          const stoppedMessage: ChatMessage = {
            id: assistantMessageId,
            role: "assistant",
            content: `${stoppedContent}\n\n[已停止]`,
            createdAt: stoppedAt,
          };
          stoppedMessage.content = `${stoppedContent}\n\n[stopped]`;
          set((current) => {
            const node = current.nodes[nodeId];
            if (!node) return {};
            const messages = stoppedContent
              ? node.messages.map((message) => (message.id === assistantMessageId ? stoppedMessage : message))
              : streamTimedOut
                ? node.messages.map((message) => (message.id === assistantMessageId ? timeoutMessage : message))
                : node.messages.filter((message) => message.id !== assistantMessageId);
            return {
              nodes: touchNotebookRoot({
                ...current.nodes,
                [nodeId]: {
                  ...node,
                  messages,
                  updatedAt: stoppedAt,
                },
              }, nodeId, stoppedAt),
              apiStatus: streamTimedOut ? "error" : "ready",
              apiError: streamTimedOut ? timeoutMessage.content : null,
            };
          });
          if (stoppedContent) {
            return postStoppedChat({
              nodeId,
              content: stoppedContent,
              assistantMessageId,
            })
              .catch((saveError) => {
                set({
                  apiStatus: "error",
                  apiError: saveError instanceof Error ? saveError.message : "保存已停止回复失败",
                });
              })
              .then(() => undefined);
          }
          return undefined;
          /*
          const stoppedMessage: ChatMessage = {
            id: assistantMessageId,
            role: "assistant",
            content: streamedContent || "已停止回复。",
            createdAt: new Date().toISOString(),
          };
          set((current) => {
            const node = current.nodes[nodeId];
            if (!node) return {};
            return {
              nodes: {
                ...current.nodes,
                [nodeId]: {
                  ...node,
                  messages: node.messages.map((message) =>
                    message.id === assistantMessageId ? stoppedMessage : message,
                  ),
                  updatedAt: stoppedMessage.createdAt,
                },
              },
              apiStatus: "ready",
              apiError: null,
            };
          });
          return undefined;
          */
        }
        if (error instanceof Error && error.message.includes("Not Found")) {
          return postChat({
            notebookId,
            nodeId,
            message: content,
            userMessageId: userMessage.id,
            assistantMessageId,
            modelName,
            thinkingMode,
            webSearch: useWebSearch,
          });
        }
        throw error;
      })
      .then((response) => {
        if (!response) return;
        const fallbackAssistantMessage: ChatMessage = response.message ?? {
          id: response.messageId,
          role: response.role,
          content: response.content,
          createdAt: response.createdAt,
        };

        set((current) => {
          const node = current.nodes[nodeId];
          if (!node) return {};
          const nextTitle = response.nodeTitle?.trim();
          const nextSummary = response.nodeSummary?.trim();
          const updatedAt = fallbackAssistantMessage.createdAt;
          return {
            nodes: touchNotebookRoot({
              ...current.nodes,
              [nodeId]: {
                ...node,
                title: nextTitle || node.title,
                summary: nextSummary || node.summary,
                messages: node.messages.map((message) =>
                  message.id === assistantMessageId ? fallbackAssistantMessage : message,
                ),
                updatedAt,
              },
            }, nodeId, updatedAt),
            apiStatus: "ready",
            apiError: null,
          };
        });
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : "模型调用失败";
        const errorMessage: ChatMessage = {
          id: uid("msg"),
          role: "system",
          content: `模型调用失败：${message}`,
          createdAt: new Date().toISOString(),
        };

        set((current) => {
          const node = current.nodes[nodeId];
          if (!node) return { apiStatus: "error", apiError: message };
          return {
            nodes: touchNotebookRoot({
              ...current.nodes,
              [nodeId]: {
                ...node,
                messages: node.messages.map((item) => (item.id === assistantMessageId ? errorMessage : item)),
                updatedAt: errorMessage.createdAt,
              },
            }, nodeId, errorMessage.createdAt),
            apiStatus: "error",
            apiError: message,
          };
        });
      })
      .finally(clearRunStatus);
  },
  retryAssistantMessage: (nodeId, assistantMessageId) => {
    const state = get();
    const node = state.nodes[nodeId];
    if (!node || state.chatRunStatusByNode[nodeId]) return;

    const originalMessage = node.messages.find((message) => message.id === assistantMessageId);
    if (!originalMessage || originalMessage.role !== "assistant") return;
    const notebookId = getNotebookRootId(state.nodes, nodeId);
    const modelConfig = state.getModelConfig({ nodeId, notebookId, threadId: nodeId });
    const modelName = modelConfig.model;
    const thinkingMode = modelConfig.thinkingMode;

    const now = new Date().toISOString();
    const controller = new AbortController();
    activeChatControllers.set(nodeId, controller);
    let streamTimedOut = false;
    const timeoutId = window.setTimeout(() => {
      streamTimedOut = true;
      controller.abort();
    }, CHAT_STREAM_TIMEOUT_MS);
    set((current) => {
      const currentNode = current.nodes[nodeId];
      if (!currentNode) return {};
      return {
        apiError: null,
        chatRunStatusByNode: { ...current.chatRunStatusByNode, [nodeId]: "thinking" },
        nodes: touchNotebookRoot({
          ...current.nodes,
          [nodeId]: {
            ...currentNode,
            messages: currentNode.messages.map((message) =>
              message.id === assistantMessageId ? { ...message, content: "正在重新生成..." } : message,
            ),
            updatedAt: now,
          },
        }, nodeId, now),
      };
    });

    let streamedContent = "";
    void postChatRetryStream(
      { nodeId, assistantMessageId, modelName, thinkingMode },
      {
        onDelta: (delta) => {
          streamedContent += delta;
          set((current) => {
            const currentNode = current.nodes[nodeId];
            if (!currentNode) return {};
            const updatedAt = new Date().toISOString();
            return {
              chatRunStatusByNode: { ...current.chatRunStatusByNode, [nodeId]: "streaming" },
              nodes: touchNotebookRoot({
                ...current.nodes,
                [nodeId]: {
                  ...currentNode,
                  messages: currentNode.messages.map((message) =>
                    message.id === assistantMessageId ? { ...message, content: streamedContent } : message,
                  ),
                  updatedAt,
                },
              }, nodeId, updatedAt),
            };
          });
        },
        onDone: (response) => {
          const replacementMessage: ChatMessage = response.message ?? {
            id: response.messageId,
            role: response.role,
            content: response.content,
            createdAt: response.createdAt,
          };

          set((current) => {
            const currentNode = current.nodes[nodeId];
            if (!currentNode) return {};
            const nextTitle = response.nodeTitle?.trim();
            const nextSummary = response.nodeSummary?.trim();
            const updatedAt = new Date().toISOString();
            return {
              nodes: touchNotebookRoot({
                ...current.nodes,
                [nodeId]: {
                  ...currentNode,
                  title: nextTitle || currentNode.title,
                  summary: nextSummary || currentNode.summary,
                  messages: currentNode.messages.map((message) =>
                    message.id === assistantMessageId ? replacementMessage : message,
                  ),
                  updatedAt,
                },
              }, nodeId, updatedAt),
              apiStatus: "ready",
              apiError: null,
            };
          });
        },
      },
      controller.signal,
    )
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError" && !streamTimedOut) return;
        const message = error instanceof Error ? error.message : "重新生成失败";
        set((current) => {
          const currentNode = current.nodes[nodeId];
          if (!currentNode) return { apiStatus: "error", apiError: message };
          return {
            apiStatus: "error",
            apiError: streamTimedOut ? "模型响应超时，请稍后重试，或切换到 Instant 模式后再发送。" : message,
            nodes: {
              ...current.nodes,
              [nodeId]: {
                ...currentNode,
                messages: currentNode.messages.map((item) =>
                  item.id === assistantMessageId ? originalMessage : item,
                ),
              },
            },
          };
        });
      })
      .finally(() => {
        window.clearTimeout(timeoutId);
        activeChatControllers.delete(nodeId);
        set((current) => {
          const { [nodeId]: _removed, ...nextStatuses } = current.chatRunStatusByNode;
          return { chatRunStatusByNode: nextStatuses };
        });
      });
  },
  stopMessage: (nodeId) => {
    activeChatControllers.get(nodeId)?.abort();
  },
  renameNode: (nodeId, title) => {
    const updatedAt = new Date().toISOString();
    set((state) => ({
      nodes: touchNotebookRoot({
        ...state.nodes,
        [nodeId]: { ...state.nodes[nodeId], title, updatedAt },
      }, nodeId, updatedAt),
    }));
    void patchBackendNode(nodeId, { title }).catch((error) => {
      set({ apiStatus: "error", apiError: error instanceof Error ? error.message : "重命名失败" });
    });
  },
  togglePinRoot: (nodeId) =>
    set((state) => {
      // 只有根节点可以置顶，避免子节点出现在首页笔记本列表中。
      const node = state.nodes[nodeId];
      if (!node || node.parentId !== null) return {};
      const alreadyPinned = state.pinnedRootIds.includes(nodeId);
      return {
        pinnedRootIds: alreadyPinned
          ? state.pinnedRootIds.filter((id) => id !== nodeId)
          : [nodeId, ...state.pinnedRootIds],
      };
    }),
  deleteNode: (nodeId) => {
    void deleteBackendNode(nodeId).catch((error) => {
      set({ apiStatus: "error", apiError: error instanceof Error ? error.message : "删除节点失败" });
    });
    set((state) => {
      // 删除时先复制 nodes，再移除目标子树，保持 Zustand 更新的不可变数据约定。
      const node = state.nodes[nodeId];
      if (!node) return {};

      const idsToDelete = new Set(collectDescendantIds(state.nodes, nodeId));
      const nodes = { ...state.nodes };
      idsToDelete.forEach((id) => delete nodes[id]);
      const filesByNode = { ...state.filesByNode };
      idsToDelete.forEach((id) => delete filesByNode[id]);

      const rootIds = state.rootIds.filter((id) => !idsToDelete.has(id));
      const pinnedRootIds = state.pinnedRootIds.filter((id) => !idsToDelete.has(id));
      const updatedAt = new Date().toISOString();
      if (node.parentId && nodes[node.parentId]) {
        nodes[node.parentId] = {
          ...nodes[node.parentId],
          children: nodes[node.parentId].children.filter((id) => !idsToDelete.has(id)),
          updatedAt,
        };
      }
      const nextNodes = node.parentId && nodes[node.parentId] ? touchNotebookRoot(nodes, node.parentId, updatedAt) : nodes;

      const fallbackId = node.parentId && nodes[node.parentId] ? node.parentId : rootIds[0];
      return {
        nodes: nextNodes,
        rootIds,
        pinnedRootIds,
        filesByNode,
        activeNodeId: idsToDelete.has(state.activeNodeId) && fallbackId ? fallbackId : state.activeNodeId,
        compareNodeId: null,
        selectionDraft: null,
      };
    });
  },
  moveNode: (nodeId, targetParentId) => {
    // 拖拽移动只允许把节点挂到另一个父节点下；相同节点或相同父节点不做处理。
    const state = get();
    const node = state.nodes[nodeId];
    if (!node || node.parentId === null || node.id === targetParentId || node.parentId === targetParentId) return;
    if (isDescendantOf(state.nodes, nodeId, targetParentId)) {
      set({ apiStatus: "error", apiError: "不能把节点移动到自己的子节点下面" });
      return;
    }

    const oldParentId = node.parentId;
    const updatedAt = new Date().toISOString();
    set((current) => {
      const nodes = { ...current.nodes };
      if (oldParentId) {
        nodes[oldParentId] = {
          ...nodes[oldParentId],
          children: nodes[oldParentId].children.filter((id) => id !== nodeId),
          updatedAt,
        };
      }
      nodes[targetParentId] = {
        ...nodes[targetParentId],
        children: [...nodes[targetParentId].children, nodeId],
        expanded: true,
        updatedAt,
      };
      nodes[nodeId] = { ...nodes[nodeId], parentId: targetParentId, updatedAt };
      return { nodes: touchNotebookRoot(touchNotebookRoot(nodes, oldParentId, updatedAt), targetParentId, updatedAt) };
    });

    void patchBackendNode(nodeId, { parentId: targetParentId }).catch((error) => {
      set({ apiStatus: "error", apiError: error instanceof Error ? error.message : "移动节点失败" });
    });
  },
  toggleSkill: (skillId) =>
    set((state) => ({
      skills: state.skills.map((skill) =>
        skill.id === skillId ? { ...skill, enabled: !skill.enabled } : skill,
      ),
    })),
}));
