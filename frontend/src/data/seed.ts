import type { KnowledgeNode, SkillTemplate } from "../types/treelearn";

// seed 数据只用于前端演示和本地开发；接入后端后可由 /api/notebooks 或 /api/nodes 替换。
const now = new Date().toISOString();

// 初始知识树：root 是笔记本主线，method/context/skill 展示支线与局部追问效果。
export const seedNodes: Record<string, KnowledgeNode> = {
  root: {
    id: "root",
    parentId: null,
    title: "TreeLearn 项目学习",
    kind: "main",
    summary: "围绕树形上下文工程理解项目背景、核心功能、技术栈和后端协作边界。",
    contextWeight: "mainline",
    children: ["method", "skill"],
    expanded: true,
    updatedAt: now,
    messages: [
      {
        id: "m-root-1",
        role: "assistant",
        createdAt: now,
        content:
          "TreeLearn 将论文、PPT、技术文档等学习过程组织成树形知识网络。主线负责宏观学习路径，支线负责局部追问，普通支线默认不污染后续主线上下文。",
      },
      {
        id: "m-root-2",
        role: "assistant",
        createdAt: now,
        content:
          "前端需要支持左侧树形节点、右侧阅读块与主子对话 3:7 分栏、选中文本创建子对话、分支超链接预览、Skill 偏好模板、导入导出和分享复习。",
      },
    ],
  },
  method: {
    id: "method",
    parentId: "root",
    title: "树形上下文调度",
    kind: "branch",
    summary: "根据根节点到当前节点路径、当前节点完整内容和选中文本构造 prompt。",
    selectedText: "树形上下文调度",
    contextWeight: "isolated",
    children: ["context"],
    expanded: true,
    updatedAt: now,
    messages: [
      {
        id: "m-method-1",
        role: "assistant",
        createdAt: now,
        content:
          "树形结构不直接改变模型 attention 权重，但可以为上下文选择、排序、压缩和标注提供依据。后端可沿路径摘要、当前节点全文和选中文本构造最终 prompt。",
      },
    ],
  },
  context: {
    id: "context",
    parentId: "method",
    title: "主线保护策略",
    kind: "branch",
    summary: "普通支线默认隔离，避免局部追问污染主线路径摘要。",
    selectedText: "普通支线默认不污染后续主线上下文",
    contextWeight: "isolated",
    children: [],
    expanded: true,
    updatedAt: now,
    messages: [
      {
        id: "m-context-1",
        role: "assistant",
        createdAt: now,
        content:
          "默认隔离策略能避免局部概念被模型误当成全局重点。支线内容保持在自己的节点上下文中，便于围绕局部问题继续追问。",
      },
    ],
  },
  skill: {
    id: "skill",
    parentId: "root",
    title: "Skill 偏好模板",
    kind: "branch",
    summary: "保存讲解结构、深度、示例风格和推导偏好。",
    selectedText: "Skill 偏好模板",
    contextWeight: "isolated",
    children: [],
    expanded: true,
    updatedAt: now,
    messages: [
      {
        id: "m-skill-1",
        role: "assistant",
        createdAt: now,
        content:
          "Skill 不是知识点总结，而是用户希望 AI 怎样讲。比如先给大纲、解释变量、给反例、遇到公式时补充推导。",
      },
    ],
  },
};

// 初始 Skill 模板：当前主要作为后端 prompt 偏好设计参考，后续可挂到设置或聊天输入区。
export const seedSkills: SkillTemplate[] = [
  {
    id: "skill-academic",
    name: "学术论文讲解",
    tags: ["论文", "公式", "推导"],
    depth: "推导",
    structure: "先给方法框架，再解释符号与变量，最后补充边界条件和反例。",
    enabled: true,
  },
  {
    id: "skill-code",
    name: "代码导读",
    tags: ["代码", "伪代码"],
    depth: "深入",
    structure: "先说明模块职责，再拆执行链路，关键函数给输入输出契约。",
    enabled: false,
  },
];
