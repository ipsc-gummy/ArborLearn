# 局部回填功能实现方案

## 0. 本次变更范围

本次改动仅新增本分支的实现说明文档，不包含后端、前端或数据库代码变更。

这份文档用于在正式开发前固定局部回填功能的产品边界、技术路线、数据模型、接口设计、前后端修改点和验收标准。后续实现应以本文档作为本分支的协作基准。

## 1. 修改内容与思路总览

本分支计划实现“局部回填”能力：用户在主对话中选中一段原文，基于这段原文开启子对话追问；当子对话把问题澄清后，用户手动填写或编辑一段替换文本，经确认后回填到主对话，并影响后续模型读取的上下文。

这个功能的核心不是“修改历史消息”，而是建立一个可追溯、可撤回、可校验的上下文补丁机制。原始消息仍然保留，回填内容以 patch 的方式覆盖主对话中的局部文本。后续模型构造上下文时读取的是应用 patch 后的 effective context，而不是直接读取原始消息文本。

本分支的主要改动方向如下：

- 新增局部回填的数据模型，用于记录用户选中的问题锚点、消息定位、消息版本、实际替换范围、替换文本、来源子对话、回填类型、映射状态和冲突状态。
- 第一版先实现手动回填闭环：选区定位、保存 patch、展示 patched 文本、上下文生效、查看原文、撤回、冲突检测。
- 第一版不依赖 AI 自动生成回填草稿，不自动判断范围，不自动判断回填类型；这些能力放到第二阶段。
- 新增 4 种回填类型：`correct`、`expand`、`compress`、`reframe`，第一版由用户手动选择。
- 新增范围记录机制：用户选区只表示问题位置，实际回填范围由用户在第一版手动确认；第二阶段再引入自动范围建议。
- 新增统一上下文构造逻辑，在所有模型请求前应用已确认的 patches，形成 effective messages。
- 新增前端交互：主对话选区追问、子对话手动回填、用户编辑确认、查看原文、查看来源、撤回回填。
- 新增旧回复 stale 标记：当早期消息被回填后，提示后续旧回复可能基于回填前上下文生成。

第一版不做自动重算历史回复，不做物理改写消息内容，不做复杂 patch 自动合并，不做 AI 自动生成回填草稿。目标是先完成一个闭环：选区定位、手动回填、确认应用、后续上下文生效、可查看可撤回。

### 1.1 第一版核心约束

第一版必须优先解决两个基础问题：

1. 选区定位不能只依赖 `selectedText`。
   系统必须稳定记录用户选的是哪条消息、原文里的哪一段、基于哪个消息版本、是否还能映射回原文。

2. 上下文一致性必须覆盖所有模型入口。
   任何会读取对话内容的后端链路都必须读取 applied patches 后的 effective context，包括普通聊天、重新生成、联网检索、长任务、摘要生成、标题生成和 context debug。不能出现部分入口读新内容、部分入口读旧内容。

因此第一版的最小闭环是：

```text
选区定位
-> 保存来源元数据
-> 用户手动创建 patch
-> 应用 patch
-> 主对话展示 patched 文本
-> 所有模型入口读取 effective context
-> 查看原文 / 撤回 / 冲突检测
```

## 2. 本质需求与产品定位

局部回填解决的是树状学习对话中的知识沉淀问题。用户在主对话中遇到某个不清楚、不准确、不完整的片段时，会通过子对话进一步追问。追问结束后，用户希望这部分新信息能回到主线，而不是散落在分支里。

因此，本功能的产品定位是：

> 子对话用于探索和澄清，回填 patch 用于沉淀和修正主对话的有效上下文。

对应痛点：

- 主对话越来越长后，局部错误或模糊内容很难维护。
- 子对话得出的结论无法自然影响主线后续推理。
- 如果只在后文补充“前面那段其实应改为...”，旧内容仍会污染模型上下文。
- 如果直接修改历史消息，又会破坏可追溯性和分支关系。

因此采用 patch overlay，而不是历史消息覆盖。

## 3. 功能范围

### 3.1 第一版需要实现

- 用户能从主对话消息中选中一段文本。
- 用户能基于选区创建子对话。
- 子对话保留来源信息：父节点、目标消息、目标消息版本、用户选区 anchor range、选中文本、选区前后文。
- 系统能在创建子对话和应用 patch 时校验 `anchorRange` / `anchorText` 是否仍能映射回原始消息。
- 子对话中提供“手动回填”入口。
- 用户手动选择回填类型、确认实际 `targetRange`、填写或编辑 replacement。
- 用户确认后保存 patch。
- 主对话展示应用 patch 后的文本。
- 所有模型调用入口使用 patched context。
- 用户能查看原文、查看来源子对话、撤回回填。
- 对同一消息内重叠的 active patch 做冲突检测，不静默覆盖。
- 回填后，对受影响的后续旧回复显示 stale 提示。

### 3.2 第一版暂不实现

- 自动重算 patch 之后的所有历史回复。
- 直接修改原始 message.content。
- 多个重叠 patch 的自动合并。
- 无用户确认的自动回填。
- 跨节点、跨 notebook 的全局知识替换。
- AI 自动生成回填草稿。
- AI 自动判断回填类型。
- AI 自动判断或扩大实际替换范围。
- AI 一致性校验与自动修订。

## 4. 回填类型设计

最终保留 4 种 `editType`：

```ts
type EditType =
  | "correct"
  | "expand"
  | "compress"
  | "reframe";
```

### 4.1 correct

用于纠错。适合原文存在事实错误、概念错误、逻辑错误时使用。

生成约束：

- 只修正必要错误。
- 尽量保留原文结构、语气和信息粒度。
- 不主动扩展无关内容。

校验重点：

- 是否真的修正了错误。
- 是否引入了子对话没有确认的新信息。
- 是否过度改变原文结论。

### 4.2 expand

用于补充。适合原文基本正确，但不完整、不够清楚、缺少必要限定条件时使用。

生成约束：

- 在原文逻辑上补充必要信息。
- 允许文本适度变长。
- 不改变原文主要结论。

校验重点：

- 补充内容是否来自子对话确认结论。
- 是否打断前后文节奏。
- 是否把局部补充扩写成无关说明。

### 4.3 compress

用于压缩。适合子对话已经把问题讲清楚后，需要把较长解释沉淀成更短、更高密度的文本。

生成约束：

- 保留核心结论。
- 删除重复解释。
- 文本长度应短于或不显著长于原文。

校验重点：

- 是否遗漏关键限定条件。
- 是否因为压缩导致指代不明。
- 是否保留了原片段在上下文中的功能。

### 4.4 reframe

用于重构。适合原文组织方式不合适，需要在保留主题的前提下重新组织论证角度。

生成约束：

- 允许重排结构和改变表达角度。
- 必须围绕原选区主题。
- 需要明确保留、调整、删除了哪些主张。

校验重点：

- 是否越界改写了原选区之外的逻辑。
- 是否与前后文发生冲突。
- 是否把局部回填变成了整段重写。

### 4.5 用户选择与第二阶段自动识别

第一版 `editType` 由用户手动选择。系统只保存用户选择的类型，并把它作为 patch 元数据和后续展示信息。

第二阶段再采用“模型推荐 + 用户确认”的方式。

流程：

1. 系统根据选区、子对话摘要、用户最后一次追问自动推荐 `editType`。
2. 前端展示推荐类型和简短理由。
3. 用户可以切换为其他类型。
4. 最终生成和保存 patch 时，以用户确认后的 `editType` 为准。

不建议完全自动识别，因为 `editType` 代表用户写作意图，不只是事实判断。

## 5. 回填范围决策

用户选中的文本不应被机械地等同于最终替换范围。用户选区通常只是指出“问题发生在哪里”，但为了让回填后的主对话仍然通顺，实际替换范围可能需要扩大到完整句子、相邻句或当前段落。

因此需要区分两层范围：

- `anchorRange`：用户最初选中的问题锚点。
- `targetRange`：系统建议并经用户确认后，实际被 replacement 替换的范围。

一句话原则：

> 用户负责指出问题点，系统负责建议最小通顺编辑范围，最终由用户确认。

第一版先不做自动范围判断。`anchorRange` 来自浏览器选区定位；`targetRange` 默认等于 `anchorRange`，允许用户在回填面板中手动调整到完整句子或当前段落。系统负责做确定性校验：范围必须落在同一条消息内，`originalText` 必须与当前原文切片一致，重叠 patch 必须报冲突。

第二阶段再引入模型辅助的范围建议和风险理由。

### 5.1 决策结果

```ts
type RangeDecision = {
  strategy: "keep" | "expand";
  anchorRangeStart: number;
  anchorRangeEnd: number;
  proposedTargetRangeStart: number;
  proposedTargetRangeEnd: number;
  reason: string;
  riskLevel: "low" | "medium" | "high";
};
```

### 5.2 决策规则

- 如果只替换用户选区就能与前后文自然衔接，使用 `keep`。
- 如果选区内的概念、代词、转折或结论影响相邻文本，使用 `expand`。
- 如果需要修改范围超过当前段落，标记为 `high`，不自动扩大，必须提示用户重新选择或手动确认。

第一版允许建议扩大的边界：

- 同一句。
- 相邻一句。
- 当前段落。

第一版不自动扩大到多个段落，也不自动改整条消息。

### 5.3 用户确认

当 `strategy = "expand"` 时，前端不应直接应用回填，而应提示：

```text
仅替换选中内容可能导致前后文不顺。
建议将回填范围扩大到当前句/相邻句/当前段落。
```

用户可选择：

- 仅改选区。
- 采用建议范围。
- 取消。

如果用户选择“仅改选区”，第一版只做确定性校验和冲突检测；第二阶段的一致性校验再检查衔接风险，并在风险较高时阻止自动应用。

## 6. 数据模型设计

### 6.1 ConversationPatch

建议新增 `conversation_patches` 表。

```ts
type ConversationPatch = {
  id: string;
  parentNodeId: string;
  sourceChildNodeId: string;

  targetMessageId: string;
  targetMessageRole: "user" | "assistant";
  targetMessageCreatedAt: string;
  baseMessageContentHash: string;
  coordinateSpace: "raw_markdown";
  renderedTextHash: string | null;
  selectorStrategy: "dom_to_raw_exact" | "raw_textarea" | "manual";
  anchorRangeStart: number;
  anchorRangeEnd: number;
  targetRangeStart: number;
  targetRangeEnd: number;

  anchorText: string;
  anchorPrefix: string;
  anchorSuffix: string;
  originalText: string;
  replacementText: string;
  baseContentLength: number;

  status: "draft" | "applied" | "rejected" | "archived";
  editType: "correct" | "expand" | "compress" | "reframe";

  mappingStatus: "exact" | "stale" | "unmapped";
  conflictPatchId: string | null;
  archiveReason: "user_reverted" | "target_message_regenerated" | "source_deleted" | "conflict_replaced" | null;

  coherencePass: boolean | null;
  coherenceRiskLevel: "low" | "medium" | "high" | null;
  coherenceIssuesJson: string | null;

  createdAt: string;
  updatedAt: string;
  appliedAt: string | null;
  archivedAt: string | null;
};
```

关键字段说明：

- `targetMessageId`：被回填的主对话消息。
- `targetMessageRole` / `targetMessageCreatedAt`：记录目标消息身份，便于审计和 stale 计算。
- `baseMessageContentHash`：创建 patch 时目标消息原文的 hash，用于判断当前 patch 是否仍基于同一消息版本。
- `coordinateSpace`：第一版固定为 `raw_markdown`。所有 range 都指向数据库中 `messages.content` 的原始 Markdown 字符串，而不是浏览器渲染后的 DOM 文本。
- `renderedTextHash`：可选记录渲染后纯文本 hash，只用于调试和排查映射问题，不能作为 patch 应用坐标。
- `selectorStrategy`：记录本次选区如何映射到 raw Markdown 坐标。第一版只有 `dom_to_raw_exact` 这类可精确映射策略才允许创建 patch。
- `anchorRangeStart` / `anchorRangeEnd`：用户最初选中的问题锚点。
- `targetRangeStart` / `targetRangeEnd`：最终实际替换的字符区间，可与 anchor range 相同，也可在用户确认后扩大。
- `anchorText`：用户最初选中的文本，用于展示追问来源。
- `anchorPrefix` / `anchorSuffix`：选区前后的短上下文，用于在 range 失效时做保守映射检查。
- `originalText`：保存实际替换范围内的原文，用于审计、对比、撤回和冲突检测。
- `replacementText`：用户最终确认后的回填文本。
- `baseContentLength`：创建 patch 时目标消息长度，用于快速发现版本偏移。
- `sourceChildNodeId`：记录回填来源子节点，保证主线修改可追溯。
- `mappingStatus`：表示当前 patch 是否还能精确映射回原文。第一版只有 `exact` 才允许应用；`stale` / `unmapped` 必须阻止应用并提示用户重新选择。
- `conflictPatchId`：当新 patch 与已有 active patch 重叠时记录冲突对象，第一版不自动合并。
- `archiveReason`：记录 patch 被撤回或自动作废的原因，尤其用于目标消息重新生成导致 patch 失效的情况。
- `status`：不删除 patch，撤回时改为 `archived`。

### 6.2 子对话来源信息

如果当前节点模型已经支持父子节点关系，可以在子节点中补充局部追问元数据。

```ts
type NodeBackfillSource = {
  parentNodeId: string;
  targetMessageId: string;
  targetMessageRole: "user" | "assistant";
  targetMessageCreatedAt: string;
  baseMessageContentHash: string;
  baseContentLength: number;
  coordinateSpace: "raw_markdown";
  selectorStrategy: "dom_to_raw_exact" | "raw_textarea" | "manual";
  anchorRangeStart: number;
  anchorRangeEnd: number;
  anchorText: string;
  anchorPrefix: string;
  anchorSuffix: string;
  targetRangeStart: number;
  targetRangeEnd: number;
  targetText: string;
  beforeContext: string;
  afterContext: string;
};
```

如果不想立即调整 nodes 表，可以先把该结构存成 JSON 字段，例如 `source_metadata_json`。

## 7. 后端接口设计

### 7.1 创建子对话

```http
POST /api/nodes
```

创建子对话应复用项目现有节点创建逻辑，而不是新增一套平行的 child-thread 创建接口。

当前项目已有：

- 后端 `POST /api/nodes`：创建节点，支持 `parentId`、`selectedText`、`contextWeight`。
- 前端 `createChildConversation(sourceNodeId, selectedText)`：从选中文本创建子对话，并切换到父子对照视图。

局部回填需要在现有子对话创建流程上补充来源定位元数据。最小改法是扩展 `NodeCreate`，增加可选的 `sourceMetadata` 字段；如果暂时不改表结构，也可以先将其保存为 JSON 字段。

请求：

```json
{
  "parentId": "node_parent",
  "title": "原文选区",
  "selectedText": "原文选区",
  "contextWeight": "isolated",
  "sourceMetadata": {
    "type": "backfill_anchor",
    "targetMessageId": "msg_123",
    "targetMessageRole": "assistant",
    "targetMessageCreatedAt": "2026-05-23T12:00:00.000Z",
    "baseMessageContentHash": "sha256:...",
    "baseContentLength": 860,
    "coordinateSpace": "raw_markdown",
    "selectorStrategy": "dom_to_raw_exact",
    "anchorRangeStart": 120,
    "anchorRangeEnd": 260,
    "anchorText": "原文选区",
    "anchorPrefix": "选区前 80 个字符",
    "anchorSuffix": "选区后 80 个字符",
    "beforeContext": "选区前文",
    "afterContext": "选区后文"
  }
}
```

其中 `sourceMetadata` 对应的核心信息是：

```json
{
  "targetMessageId": "msg_123",
  "targetMessageRole": "assistant",
  "targetMessageCreatedAt": "2026-05-23T12:00:00.000Z",
  "baseMessageContentHash": "sha256:...",
  "baseContentLength": 860,
  "coordinateSpace": "raw_markdown",
  "selectorStrategy": "dom_to_raw_exact",
  "anchorRangeStart": 120,
  "anchorRangeEnd": 260,
  "anchorText": "原文选区",
  "anchorPrefix": "选区前 80 个字符",
  "anchorSuffix": "选区后 80 个字符",
  "beforeContext": "选区前文",
  "afterContext": "选区后文"
}
```

响应：

```json
{
  "id": "node_child",
  "notebookId": "notebook_id"
}
```

职责：

- 复用现有子节点创建逻辑，保持树结构和父子对照 UI 一致。
- 校验父节点归属当前用户。
- 如果带有 `sourceMetadata`，额外校验消息归属当前用户。
- 校验 anchor range 与 `anchorText` 匹配。
- 校验 `baseMessageContentHash` 与目标消息当前原文匹配；不匹配时拒绝创建或标记为 `stale`。
- 保存选区来源信息。此时 `anchorRange` 代表用户指出的问题位置，不代表最终一定只替换该范围。

### 7.2 第一版：手动创建 patch

```http
POST /api/backfill/patches
```

请求：

```json
{
  "sourceChildNodeId": "node_child",
  "targetMessageId": "msg_123",
  "editType": "expand",
  "targetRangeStart": 120,
  "targetRangeEnd": 260,
  "replacementText": "用户手动确认后的回填文本"
}
```

响应：

```json
{
  "patchId": "patch_draft",
  "status": "draft",
  "mappingStatus": "exact"
}
```

职责：

- 读取子对话保存的 `sourceMetadata`。
- 校验当前用户拥有父节点、子节点和目标消息。
- 校验 `targetMessageId` 与 `sourceMetadata.targetMessageId` 一致。
- 校验目标消息当前原文 hash 与 `baseMessageContentHash` 一致。
- 校验 `anchorRange` 能切出 `anchorText`。
- 校验 `targetRange` 能切出 `originalText`，且第一版必须位于同一条消息内。
- 检测同一消息内已有 `draft` / `applied` patch 是否与新 `targetRange` 重叠。
- 无冲突时保存为 `draft` patch；如果用户选择立即应用，可在同一请求中传 `apply: true`，但仍必须经过上述校验。

### 7.3 第一版：应用回填

```http
POST /api/backfill/patches/{patchId}/apply
```

请求：

```json
{
  "replacementText": "用户编辑后的最终文本"
}
```

响应：

```json
{
  "patchId": "patch_123",
  "status": "applied",
  "mappingStatus": "exact"
}
```

职责：

- 再次校验 patch 目标消息仍存在。
- 再次校验目标消息版本、`targetRange`、`originalText`。
- 再次检测 active patch 重叠冲突。
- 将用户编辑后的文本写入 `replacementText`。
- 将 patch 状态改为 `applied`。
- 不修改原始 `message.content`。
- 标记受影响的旧消息为 stale 或在读取时动态计算 stale 状态。

### 7.4 第一版：撤回回填

```http
POST /api/backfill/patches/{patchId}/archive
```

职责：

- 将 patch 状态改为 `archived`。
- 后续上下文构造不再应用该 patch。
- 原始消息内容不需要修改。

### 7.5 第一版：查询消息 patches

```http
GET /api/messages/{messageId}/patches
```

用于前端展示：

- 当前消息有哪些已应用回填。
- 原文与替换文本对比。
- 来源子对话链接。
- patch 状态、映射状态和冲突提示。

### 7.6 第二阶段：推断回填类型

```http
POST /api/backfill/infer-edit-type
```

### 7.7 第二阶段：决策回填范围

```http
POST /api/backfill/range-decision
```

### 7.8 第二阶段：生成回填草稿

```http
POST /api/backfill/draft
```

第二阶段接口复用第一版保存的选区定位、消息版本和 patch 数据模型，但输出只作为用户可编辑草稿，不能绕过用户确认直接应用。

## 8. 生成链路设计

本章属于第二阶段。第一版只提供手动填写 / 编辑 replacement 的闭环，不调用模型生成回填草稿。

生成回填不能直接“总结子对话”，而要做上下文感知的局部编辑。

完整链路：

```text
anchorRange
-> 提炼子对话结论
-> rangeDecision
-> 用户确认 targetRange
-> 生成编辑计划
-> 生成 replacement
-> 一致性校验
-> 用户确认应用
```

### 8.1 第一步：提炼子对话结论

输入：

```ts
type ExtractFindingsInput = {
  anchorText: string;
  childThreadMessages: Message[];
};
```

输出：

```ts
type ExtractFindingsOutput = {
  confirmedFindings: string[];
  uncertainFindings: string[];
  userIntentHint: string;
};
```

要求：

- 只提炼子对话中已经确认的信息。
- 对未确定信息单独列出，不进入 replacement。
- 保留用户真实意图，例如“纠错”“补充”“压缩”“换角度”。

### 8.2 第二步：决策回填范围

输入：

```ts
type DecideRangeInput = {
  anchorText: string;
  beforeContext: string;
  afterContext: string;
  confirmedFindings: string[];
  editType: EditType;
};
```

输出：

```ts
type DecideRangeOutput = RangeDecision;
```

要求：

- 优先保持用户选区。
- 只有当局部替换会造成前后文不通顺时，才建议扩大。
- 扩大范围必须是最小必要范围。
- 建议扩大时必须给出原因。

### 8.3 第三步：生成编辑计划

输入：

```ts
type BuildEditPlanInput = {
  beforeContext: string;
  anchorText: string;
  targetText: string;
  afterContext: string;
  confirmedFindings: string[];
  editType: EditType;
};
```

输出：

```ts
type EditPlan = {
  editType: EditType;
  preservedClaims: string[];
  changedClaims: string[];
  removedClaims: string[];
  addedClaims: string[];
  coherenceRisks: string[];
};
```

作用：

- 先规划再生成，降低模型跑偏概率。
- 让用户和调试日志能看到这次回填到底改了什么。
- 为一致性校验提供对照对象。

### 8.4 第四步：生成 replacement

核心 prompt 约束：

```text
你不是在总结子对话，而是在生成一段可以替换 targetText 的局部文本。
anchorText 是用户指出的问题锚点，targetText 是经用户确认后实际允许替换的文本。

要求：
1. 保持原片段在全文中的功能不变。
2. 保持 beforeContext 和 afterContext 的逻辑衔接。
3. 保留原文中仍然正确的信息。
4. 只引入 confirmedFindings 中的信息。
5. 不额外扩写无关内容。
6. 保持语气、粒度、指代关系一致。
7. 遵守 editType 对应的改写边界。
```

### 8.5 第五步：一致性校验

校验项：

- replacement 是否能直接替换 targetText。
- 是否与 beforeContext / afterContext 衔接自然。
- 是否回应了 anchorText 指向的问题。
- 是否改变了 editType 不允许改变的原结论。
- 是否引入了子对话没有支持的新信息。
- 是否存在“这”“它”“上述”等指代断裂。
- 信息密度是否与原文严重不匹配。

输出：

```ts
type CoherenceReport = {
  pass: boolean;
  riskLevel: "low" | "medium" | "high";
  issues: string[];
  suggestedRevision?: string;
};
```

如果 `pass=false` 且存在 `suggestedRevision`，后端可以自动修订一次。第二次仍不通过时，返回给用户并标记风险，不自动应用。

## 9. 上下文构造策略

回填影响父节点上下文的关键不在于修改原始消息，而在于构造模型上下文时应用 patch。

### 9.1 Effective Message

新增工具函数：

```ts
function buildEffectiveMessageText(
  content: string,
  patches: ConversationPatch[]
): string {
  const appliedPatches = patches
    .filter((patch) => patch.status === "applied")
    .sort((a, b) => b.targetRangeStart - a.targetRangeStart);

  return appliedPatches.reduce((text, patch) => {
    return (
      text.slice(0, patch.targetRangeStart) +
      patch.replacementText +
      text.slice(patch.targetRangeEnd)
    );
  }, content);
}
```

必须从后往前应用 patch，避免较早替换改变后续 range 的字符位置。

### 9.2 Context Builder 集成

当前 README 描述的上下文策略包含：

- root node title and summary
- current node title, summary, context mode
- parent node title, summary, selected text, and recent turns
- current node recent turns

实现时需要在 `context_builder` 读取消息后增加 patch 应用层：

```text
raw messages
-> load applied patches by message ids
-> build effective message content
-> assemble model context
```

这样后续 AI 回复天然使用回填后的上下文。

第一版必须把 effective context 抽成后端共享能力，而不是只在普通聊天接口里局部处理。建议新增类似 `effective_messages.py` 或 `backfill_context.py` 的模块，集中提供：

```py
build_effective_message_content(conn, message_id, raw_content)
list_effective_messages(conn, node_id, before_created_at=None, limit=...)
build_effective_tree_context(conn, node_id)
```

以下入口必须统一读取 effective context：

- `POST /api/chat`
- `POST /api/chat/stream`
- `POST /api/chat/retry`
- `POST /api/chat/retry/stream`
- `GET /api/context/debug`
- `maybe_generate_root_title`
- `maybe_generate_node_summary`
- `maybe_generate_branch_summary`
- `build_step_context`，也就是长任务规划、步骤执行、最终汇总依赖的树上下文
- 联网检索回答中的上下文拼装，包括 web evidence 与节点历史合并时的 message 内容

验收时需要专门验证这些入口不会分别读取 raw message 和 patched message，避免“普通聊天读新内容，重新生成或长任务仍读旧内容”的不一致。

### 9.3 Stale 状态

当 patch 应用到较早消息后，后续旧消息可能基于旧上下文生成。

第一版建议动态计算：

```text
如果 message.createdAt > patch.appliedAt 的目标消息 createdAt
且 message.createdAt < patch.appliedAt
则该 message 可以标记为 stale
```

更简单的实现：

```text
如果 message.createdAt > targetMessage.createdAt
且存在 applied patch 指向 targetMessage
则显示轻量 stale 提示
```

UI 文案建议：

```text
这条回复基于回填前的上下文生成。
```

第一版只提示，不自动重算。

## 10. 前端交互设计

### 10.1 主对话选区追问

当前前端已有 `SelectionBubble` 组件，复用。

第一版必须先解决 Markdown 渲染与 range 坐标的错位问题。assistant 消息支持 Markdown 渲染，浏览器 `Selection` 拿到的是渲染后 DOM 文本；而 patch 替换必须作用在数据库里的 `message.content` 原始 Markdown 字符串上。两者不能直接共用字符绝对索引。

因此 V1 坐标约定如下：

- patch 的 `anchorRange` / `targetRange` 永远使用 raw Markdown 坐标，即 `messages.content` 的字符串偏移。
- DOM 选区必须通过显式 source map 映射回 raw Markdown 坐标。
- 如果无法精确映射，不能创建回填来源，只允许复制或普通搜索。
- 不能用 rendered plain text 的 offset 去 slice raw Markdown。

实现建议：

- 渲染 Markdown 时，为可选中文本节点保留 raw offset 映射，例如在渲染前构建 Markdown AST source positions，或在渲染组件中输出 `data-source-start` / `data-source-end`。
- 用户选区的 start/end 必须落在同一条消息的可映射文本节点内。
- 选区跨越 Markdown token 边界时，只有能合并成连续 raw Markdown range 才允许创建 patch。
- 对 code block、link text、list marker、表格等 source map 不稳定区域，第一版可以直接禁用回填入口。
- user 消息若按纯文本展示，也仍统一记录为 `raw_markdown` 坐标，避免两套坐标系统。

交互：

1. 用户在消息正文中选中文本。
2. 浮层出现“子对话”按钮。
3. 点击后创建子对话。
4. 子对话页面或节点面板中展示选区来源。

选区数据需要包含：

- `targetMessageId`
- `targetMessageRole`
- `targetMessageCreatedAt`
- `baseMessageContentHash`
- `baseContentLength`
- `anchorRangeStart`
- `anchorRangeEnd`
- `anchorText`
- `anchorPrefix`
- `anchorSuffix`
- `beforeContext`
- `afterContext`
- `coordinateSpace`
- `selectorStrategy`

前端不能只把 `window.getSelection().toString()` 存成 `selectedText`。需要从消息正文容器定位到具体 `MessageBlock`，并把 range 转换为该条消息原始 Markdown 的字符偏移。第一版可要求只有在单条消息正文内完成的连续选区才允许创建子对话；跨消息选区、无法映射到原文的选区、落在已回填区域但无法映射回原始坐标的选区，都应禁用回填入口。

### 10.2 子对话手动回填

在子对话界面增加“手动回填”按钮。第一版不调用类型推荐、范围决策和草稿生成接口。

点击后：

1. 展示回填方式选择器。
2. 默认 `targetRange = anchorRange`。
3. 允许用户切换到完整句子或当前段落等确定性范围。
4. 展示 `targetRange` 对应原文。
5. 用户填写或编辑 replacement。
6. 用户点击应用后创建并应用 patch。

UI 上建议显示 4 个按钮：

```text
纠错 / 补充 / 压缩 / 重构
```

不要展示过多技术枚举名。

### 10.3 回填确认面板

打开手动回填后展示编辑面板：

- 原文。
- 实际回填范围说明；如果大于用户选区，需要展示用户当前选择的范围。
- 回填文本编辑框。
- 选区映射状态、消息版本状态、冲突状态。
- 应用按钮。
- 取消按钮。

用户可以手动修改 replacement，再应用。

### 10.4 主对话展示 patch

已应用 patch 的消息默认展示 patched 后文本。

消息局部可以提供轻量操作：

- 查看原文。
- 查看来源追问。
- 撤回回填。

如果实现局部高亮成本较高，第一版可以先在消息级显示“包含回填”标记，点击后打开 patch 列表。

## 11. 冲突处理

第一版采用保守策略。

### 11.1 冲突定义

同一消息内，两个 active patch 的 range 发生重叠：

```ts
function isRangeOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number) {
  return aStart < bEnd && bStart < aEnd;
}
```

### 11.2 冲突处理

如果创建或应用 patch 时发现冲突：

- 不自动合并。
- 提示用户已有回填覆盖该区域。
- 提供选择：
  - 保留旧回填。
  - 撤回旧回填后应用新回填。
  - 取消本次操作。

第一版不提供复杂文本 merge。

### 11.3 与重新生成回复的冲突

当前产品支持“重新生成某条 assistant 回复”。这会直接改变目标消息的 `content`，使挂在该消息上的 `targetRange`、`originalText` 和 `baseMessageContentHash` 失效。

第一版规则：

- 任何重新生成目标消息的操作，在覆盖消息内容前，必须自动归档该消息上所有 `draft` / `applied` patches。
- 自动归档时设置 `archiveReason = "target_message_regenerated"`。
- 前端点击重新生成前必须显示强警告弹窗，说明该消息上的回填会作废，用户确认后才继续。
- 后端 `POST /api/chat/retry` 和 `POST /api/chat/retry/stream` 必须在同一事务或同一服务流程中完成：归档 patches -> 重新生成 -> 更新消息。
- 如果归档失败，不允许继续重新生成，避免生成后留下孤儿 patch。

UI 文案建议：

```text
重新生成会替换这条回复，并使这条回复上的所有回填失效。原回填记录会被归档，后续上下文不再使用它们。
```

### 11.4 与节点拖拽移动的冲突

当前产品支持拖拽移动节点。局部回填不能依赖“当前父子层级仍然不变”，否则用户移动来源子节点后，patch 会在应用时被错误拒绝。

第一版规则：

- patch 与 source metadata 绑定到物理 ID：`targetMessageId`、`parentNodeId`、`sourceChildNodeId`、`baseMessageContentHash`。
- `sourceChildNodeId` 只要求存在且当前用户可访问，并且它保存的 source metadata 指向同一个 `targetMessageId`。
- 不要求 `sourceChildNodeId` 当前仍然是 `parentNodeId` 的子节点。
- `parentNodeId` 表示创建回填来源时的原始父节点，用于审计和回溯，不作为当前树结构硬约束。
- 节点移动时，如果该节点是某个未完成回填的来源节点，前端应提示“移动不会改变回填来源，但来源链接仍指向原消息”；第一版不自动清理 draft patch。

如果后续产品希望移动节点时作废 draft，可以增加显式策略，但不能让后端校验隐式依赖当前父子层级。

## 12. 后端修改说明

预计涉及文件：

- `backend/app/db.py`

  - 新增 `conversation_patches` 表初始化。
  - 如需要，新增子对话 source metadata 字段。
- `backend/app/main.py`

  - 新增 backfill 相关 API。
  - 做用户权限校验、range 校验、patch 状态流转。
  - 在 `chat/retry` 与 `chat/retry/stream` 覆盖目标消息前自动归档该消息 patches。
- `backend/app/context_builder.py`

  - 加载 applied patches。
  - 构造 effective message content。
  - 确保 parent/current recent turns 使用 patched content。
- `backend/app/long_task_context.py`

  - 使用同一套 effective message / effective tree context 能力，确保长任务不读取旧内容。
- `backend/app/model_client.py`

  - 可复用现有模型调用。
  - 第一版不需要新增结构化 JSON 输出调用封装。

建议新增文件：

- `backend/app/backfill.py`
  - 第一版放置 source metadata 校验、hash 校验、raw Markdown range 校验、patch 应用、撤回、自动归档、冲突检测等业务逻辑。
- `backend/app/effective_context.py`
  - 集中提供 applied patch 加载和 effective message 构造，供普通聊天、重试、长任务、联网检索、摘要和 debug 复用。

这样可以避免 `main.py` 继续膨胀。

## 13. 前端修改说明

预计涉及文件：

- `frontend/src/types/treelearn.ts`

  - 新增 `ConversationPatch`、`EditType`、`CoherenceReport` 类型。
- `frontend/src/lib/api.ts`

  - 新增 backfill API 方法。
- `frontend/src/components/SelectionBubble.tsx`

  - 增加“追问”入口，提交消息级选区定位信息。
  - 将 DOM 选区映射到 raw Markdown 坐标；无法精确映射时禁用回填入口。
  - 禁止跨消息、无法映射、落在不可映射 patch 区域的选区创建回填来源。
- `frontend/src/components/MessageBlock.tsx`

  - 支持显示 patched content。
  - 显示 patch 标记、查看原文、查看来源。
  - 显示 stale 提示。
  - 重新生成含 patch 的 assistant 消息前显示强警告。
- `frontend/src/components/MarkdownContent.tsx`

  - 为 Markdown 渲染提供 raw source offset 映射，或显式标记不可映射区域。
- `frontend/src/components/NodePanel.tsx` 或相关聊天面板

  - 在子对话中展示“手动回填”按钮。
  - 打开回填确认面板。
- `frontend/src/components/KnowledgeTree.tsx`

  - 拖拽移动包含未完成回填来源的节点时给出提示，但不依赖当前父子关系决定 patch 是否可应用。

建议新增组件：

- `frontend/src/components/BackfillPanel.tsx`
  - 回填类型选择。
  - target range 确认。
  - replacement 编辑。
  - 原文、映射状态、版本状态、冲突状态展示。
  - 应用 / 取消操作。

## 14. 数据一致性与权限

必须校验：

- 当前用户拥有 parent thread、child thread、target message 的访问权。
- `targetMessageId` 属于 `parentNodeId`。
- `sourceChildNodeId` 必须存在且当前用户可访问。
- `sourceChildNodeId` 的 source metadata 必须指向同一个 `targetMessageId` 和创建时的 `parentNodeId`。
- 不要求 `sourceChildNodeId` 当前仍然挂在 `parentNodeId` 下，节点拖拽移动不能使已有回填来源天然失效。
- `baseMessageContentHash` 必须与目标消息当前原文匹配。
- `coordinateSpace` 第一版必须为 `raw_markdown`。
- `anchorText` 必须与 `anchorRangeStart` / `anchorRangeEnd` 切出的文本一致。
- `anchorPrefix` / `anchorSuffix` 可用于辅助判断 range 是否仍然映射到同一处原文。
- `targetRangeStart` / `targetRangeEnd` 必须位于同一条消息内。
- 当 `targetRange` 大于 `anchorRange` 时，第一版必须有用户手动确认记录。
- 同一消息内 active patch 的 `targetRange` 不能重叠。
- 应用 patch 前，`targetRangeStart` / `targetRangeEnd` 切出的文本仍然匹配 `originalText`。
- `replacementText` 不能为空，且长度应有上限。
- 重新生成目标 assistant 消息前，必须自动归档该消息上的 `draft` / `applied` patches。

不要把模型生成内容直接应用，必须经过用户确认。

## 15. 开发顺序

建议按以下顺序实施：

1. 建立 `ConversationPatch` 数据模型、表结构和 source metadata 存储。
2. 实现消息级选区定位：`targetMessageId`、raw Markdown 坐标、消息 hash、前后缀上下文。
3. 实现选区创建子对话，并保存 source metadata。
4. 实现手动 patch 创建、查询、应用、撤回 API，不接模型，先用手动 replacement 跑通闭环。
5. 实现 range / hash / originalText / overlap 冲突检测。
6. 实现重新生成目标消息前自动归档 patches，并接入前端强警告。
7. 调整节点移动校验：patch 绑定物理 ID 和 source metadata，不依赖当前父子层级。
8. 抽出 effective context 共享模块。
9. 在普通聊天、流式聊天、重新生成、联网检索、摘要生成、长任务和 debug 入口统一接入 effective context。
10. 前端接入选区追问、手动回填确认、主对话 patched 展示、查看原文、查看来源、撤回。
11. 增加 stale 提示。
12. 第二阶段再增加 `inferEditType`、`range-decision`、`draft` 生成链路。
13. 第二阶段再增加 AI 一致性校验和风险提示。

这个顺序的原则是先打通数据闭环，再引入模型生成质量优化。

## 16. 验收标准

第一版完成后应满足：

- 能从主对话任意一条消息中选择局部文本并创建子对话。
- 子对话能记住自己来源于哪条消息、哪段文本、哪个消息版本。
- assistant Markdown 消息的选区坐标必须能精确映射到 raw Markdown；不能映射时不能创建回填。
- 系统能区分用户选区 `anchorRange` 和实际替换范围 `targetRange`，并保存二者。
- 如果目标消息原文、hash 或 range 无法匹配，系统必须阻止应用并提示重新选择。
- 用户可以手动填写或编辑一段可回填文本。
- 用户可以选择 `correct`、`expand`、`compress`、`reframe` 中的一种回填方式。
- 用户确认后，主对话显示回填后的内容。
- 原文仍可查看，回填来源仍可追溯。
- 普通聊天、重新生成、联网检索、摘要生成、长任务和 context debug 都使用回填后的上下文。
- 回填后，旧回复能显示基于旧上下文的提示。
- 回填可以撤回，撤回后上下文恢复为未应用 patch 的状态。
- 重叠回填不会静默覆盖，必须提示冲突。
- 重新生成含 patch 的 assistant 消息时，必须强警告并自动归档该消息上的 patches。
- 移动来源子节点后，已保存的 patch 仍可基于物理 ID 和 source metadata 校验；不会因为当前父子层级变化而误报失败。

## 17. 验证计划

后端验证：

- 创建 patch 表后启动服务无报错。
- 创建子对话时，非法 message id、非法 range、非本人资源会被拒绝。
- 创建子对话时，`anchorRange`、`anchorText`、`baseMessageContentHash` 不匹配会被拒绝或标记不可应用。
- Markdown 渲染后的 DOM 选区不能直接作为 raw Markdown range；无法精确映射时必须拒绝。
- 手动创建 patch 时，`targetRange` 超出目标消息、`originalText` 不匹配、replacement 为空都会被拒绝。
- 应用 patch 后，查询消息能看到 patch 状态变化。
- 撤回 patch 后，context builder 不再应用该 patch。
- 重叠 patch 会被识别。
- 重新生成目标消息会自动归档该消息上的 draft / applied patches，并记录 `archiveReason`。
- 移动来源节点后，patch 应用校验不要求 source child 当前仍在原父节点下。
- 普通聊天、重试、联网检索、摘要生成、长任务和 context debug 都能观测到 patched content。

前端验证：

- 选中文本后能出现追问入口。
- 创建子对话后，来源选区显示正确。
- 跨消息或无法映射回原文的选区不会创建回填来源。
- Markdown code block、link、table 等无法稳定映射区域不会出现回填入口。
- 用户可以在回填面板中确认 target range 并编辑 replacement。
- 应用后主对话展示变化。
- 刷新页面后 patch 状态仍然存在。
- 查看原文、查看来源、撤回功能可用。
- 点击重新生成带 patch 的 assistant 消息时会出现强警告，确认后原 patches 被归档。
- 拖拽移动来源子节点时不会让已有 patch 变成不可应用的孤儿状态。

上下文验证：

- 构造一个可观察测试：原文包含错误信息，应用 `correct` patch 后继续提问。
- 检查后续模型回复是否基于回填后的文本，而不是原错误文本。

质量验证：

- `correct` 不应过度扩写。
- `expand` 可以适度变长，但不能改变主结论。
- `compress` 不应遗漏关键限定。
- `reframe` 可以重组，但不能越界改写选区之外内容。
- 如果实际替换范围大于用户选区，replacement 必须同时解决 anchorText 的问题，并保证 targetText 替换后前后文通顺。

## 18. 风险与取舍

### 18.1 range 偏移风险

如果同一消息已有 patch，再对 patched 文本继续选区，range 坐标可能不再对应原始 message.content。

第一版建议：

- `anchorRange` 和 `targetRange` 都始终映射到原始消息坐标。
- 如果无法可靠映射，则禁止在已回填区域内再次创建 patch。
- 后续再考虑建立 patch-aware selection mapping。

### 18.2 范围扩大越权风险

系统建议扩大回填范围时，可能会让用户感觉“我只选了一小块，系统却要改更多内容”。

解决方式：

- 默认优先保持 `anchorRange`。
- 只在衔接、指代、因果或结论会断裂时建议扩大。
- 扩大范围必须展示原因。
- 超过当前段落的扩大建议必须阻止自动应用。
- 最终 `targetRange` 必须由用户确认。

### 18.3 模型生成偏离原逻辑

解决方式：

- 使用 edit plan。
- 使用 beforeContext / afterContext。
- 使用 coherence check。
- 用户必须手动确认。

### 18.4 用户误以为历史被修改

解决方式：

- UI 命名使用“回填”“上下文补丁”“查看原文”。
- 不使用“修改历史”“覆盖原消息”等文案。
- 始终允许查看原文和来源子对话。

### 18.5 自动重算复杂度过高

第一版只标记 stale，不自动重算。

原因：

- 自动重算会带来成本、等待时间和版本冲突。
- 用户可能希望保留旧分支作为思考痕迹。
- 树状学习产品中，分支本身就是合理历史。

## 19. 最终设计原则

局部回填应遵循以下原则：

- 回填是 patch，不是历史改写。
- 子对话负责探索，patch 负责沉淀。
- 用户确认优先于模型自动应用。
- 后续上下文读取 effective context。
- 原文可追溯，回填可撤回。
- 第一版先闭环，再追求智能合并和自动重算。
