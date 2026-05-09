import { create } from "zustand";
import { seedSkills } from "../data/seed";
import {
  clearAuthToken,
  createBackendNode,
  deleteBackendNode,
  fetchMe,
  fetchTreeState,
  getAuthToken,
  login as loginRequest,
  patchBackendNode,
  postChat,
  postChatStream,
  postStoppedChat,
  register as registerRequest,
  setAuthToken,
  type AuthUser,
} from "../lib/api";
import type { ChatMessage, KnowledgeNode, SelectionDraft, SkillTemplate } from "../types/treelearn";
import { uid } from "../lib/utils";

type ChatRunStatus = "thinking" | "streaming";
const activeChatControllers = new Map<string, AbortController>();

// 全局状态集中放在 Zustand：组件只订阅自己需要的字段，避免层层传 props。
interface TreeLearnState {
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
  chatRunStatusByNode: Record<string, ChatRunStatus>;
  // selectionDraft 存放用户划选文本后的临时悬浮条数据。
  selectionDraft: SelectionDraft | null;
  skills: SkillTemplate[];
  initializeAuth: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName?: string) => Promise<void>;
  logout: () => void;
  hydrateFromBackend: () => Promise<void>;
  createRootConversation: () => string;
  createChildNodeUnderActive: () => string;
  setActiveNode: (nodeId: string) => void;
  closeChildConversation: () => void;
  toggleSidebar: () => void;
  toggleNode: (nodeId: string) => void;
  setSelectionDraft: (draft: SelectionDraft | null) => void;
  createChildConversation: (sourceNodeId: string, selectedText: string) => string;
  appendMessage: (nodeId: string, content: string) => void;
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

function isDescendantOf(nodes: Record<string, KnowledgeNode>, nodeId: string, candidateParentId: string): boolean {
  const children = nodes[nodeId]?.children ?? [];
  if (children.includes(candidateParentId)) return true;
  return children.some((childId) => isDescendantOf(nodes, childId, candidateParentId));
}

export const useTreeLearnStore = create<TreeLearnState>((set, get) => ({
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
  chatRunStatusByNode: {},
  selectionDraft: null,
  skills: seedSkills,
  initializeAuth: async () => {
    if (!getAuthToken()) {
      set({ authStatus: "anonymous", user: null, nodes: {}, rootIds: [], pinnedRootIds: [], activeNodeId: "" });
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
      const activeNodeId = state.rootIds[0] ?? "";
      set({
        nodes: state.nodes,
        rootIds: state.rootIds,
        pinnedRootIds: state.pinnedRootIds,
        activeNodeId,
        compareNodeId: null,
        selectionDraft: null,
        apiStatus: "ready",
        apiError: null,
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes("Authentication")) {
        clearAuthToken();
        set({ authStatus: "anonymous", user: null, nodes: {}, rootIds: [], pinnedRootIds: [], activeNodeId: "" });
      }
      set({ apiStatus: "error", apiError: error instanceof Error ? error.message : "无法连接 TreeLearn API" });
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

    set((current) => ({
      nodes: {
        ...current.nodes,
        [parentId]: {
          ...current.nodes[parentId],
          children: [...current.nodes[parentId].children, newNode.id],
          expanded: true,
          updatedAt: new Date().toISOString(),
        },
        [newNode.id]: newNode,
      },
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
  createChildConversation: (sourceNodeId, selectedText) => {
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
      nodes: {
        ...state.nodes,
        [sourceNodeId]: {
          ...state.nodes[sourceNodeId],
          children: [...state.nodes[sourceNodeId].children, id],
          expanded: true,
          updatedAt: now,
        },
        [id]: newNode,
      },
      activeNodeId: id,
      compareNodeId: sourceNodeId,
      selectionDraft: null,
    }));

    void createBackendNode(newNode, getNotebookRootId(get().nodes, sourceNodeId)).catch((error) => {
      set({ apiStatus: "error", apiError: error instanceof Error ? error.message : "创建子对话失败" });
    });
    return id;
  },
  appendMessage: (nodeId, content) => {
    const state = get();
    if (state.chatRunStatusByNode[nodeId]) return;

    const now = new Date().toISOString();
    const notebookId = getNotebookRootId(state.nodes, nodeId);
    const userMessage: ChatMessage = { id: uid("msg"), role: "user", content, createdAt: now };
    const assistantMessageId = uid("msg");
    const controller = new AbortController();
    activeChatControllers.set(nodeId, controller);
    const assistantMessage: ChatMessage = {
      id: assistantMessageId,
      role: "assistant",
      content: "正在思考...",
      createdAt: now,
    };

    set((current) => ({
      nodes: {
        ...current.nodes,
        [nodeId]: {
          ...current.nodes[nodeId],
          messages: [...current.nodes[nodeId].messages, userMessage, assistantMessage],
          updatedAt: now,
        },
      },
      apiError: null,
      chatRunStatusByNode: { ...current.chatRunStatusByNode, [nodeId]: "thinking" },
    }));

    let streamedContent = "";
    const clearRunStatus = () => {
      activeChatControllers.delete(nodeId);
      set((current) => {
        const { [nodeId]: _removed, ...nextStatuses } = current.chatRunStatusByNode;
        return { chatRunStatusByNode: nextStatuses };
      });
    };

    void postChatStream(
      { notebookId, nodeId, message: content, userMessageId: userMessage.id, assistantMessageId },
      {
        onDelta: (delta) => {
          streamedContent += delta;
          set((current) => {
            const node = current.nodes[nodeId];
            if (!node) return {};
            return {
              chatRunStatusByNode: { ...current.chatRunStatusByNode, [nodeId]: "streaming" },
              nodes: {
                ...current.nodes,
                [nodeId]: {
                  ...node,
                  messages: node.messages.map((message) =>
                    message.id === assistantMessageId ? { ...message, content: streamedContent } : message,
                  ),
                  updatedAt: new Date().toISOString(),
                },
              },
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
            return {
              nodes: {
                ...current.nodes,
                [nodeId]: {
                  ...node,
                  title: nextTitle || node.title,
                  summary: nextSummary || node.summary,
                  messages: node.messages.map((message) =>
                    message.id === assistantMessageId ? finalAssistantMessage : message,
                  ),
                  updatedAt: finalAssistantMessage.createdAt,
                },
              },
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
              : node.messages.filter((message) => message.id !== assistantMessageId);
            return {
              nodes: {
                ...current.nodes,
                [nodeId]: {
                  ...node,
                  messages,
                  updatedAt: stoppedAt,
                },
              },
              apiStatus: "ready",
              apiError: null,
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
          return postChat({ notebookId, nodeId, message: content, userMessageId: userMessage.id, assistantMessageId });
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
          return {
            nodes: {
              ...current.nodes,
              [nodeId]: {
                ...node,
                title: nextTitle || node.title,
                summary: nextSummary || node.summary,
                messages: node.messages.map((message) =>
                  message.id === assistantMessageId ? fallbackAssistantMessage : message,
                ),
                updatedAt: fallbackAssistantMessage.createdAt,
              },
            },
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
            nodes: {
              ...current.nodes,
              [nodeId]: {
                ...node,
                messages: node.messages.map((item) => (item.id === assistantMessageId ? errorMessage : item)),
                updatedAt: errorMessage.createdAt,
              },
            },
            apiStatus: "error",
            apiError: message,
          };
        });
      })
      .finally(clearRunStatus);
  },
  stopMessage: (nodeId) => {
    activeChatControllers.get(nodeId)?.abort();
  },
  renameNode: (nodeId, title) => {
    set((state) => ({
      nodes: {
        ...state.nodes,
        [nodeId]: { ...state.nodes[nodeId], title, updatedAt: new Date().toISOString() },
      },
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

      const rootIds = state.rootIds.filter((id) => !idsToDelete.has(id));
      const pinnedRootIds = state.pinnedRootIds.filter((id) => !idsToDelete.has(id));
      if (node.parentId && nodes[node.parentId]) {
        nodes[node.parentId] = {
          ...nodes[node.parentId],
          children: nodes[node.parentId].children.filter((id) => !idsToDelete.has(id)),
        };
      }

      const fallbackId = node.parentId && nodes[node.parentId] ? node.parentId : rootIds[0];
      return {
        nodes,
        rootIds,
        pinnedRootIds,
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
    set((current) => {
      const nodes = { ...current.nodes };
      if (oldParentId) {
        nodes[oldParentId] = {
          ...nodes[oldParentId],
          children: nodes[oldParentId].children.filter((id) => id !== nodeId),
        };
      }
      nodes[targetParentId] = {
        ...nodes[targetParentId],
        children: [...nodes[targetParentId].children, nodeId],
        expanded: true,
      };
      nodes[nodeId] = { ...nodes[nodeId], parentId: targetParentId };
      return { nodes };
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
