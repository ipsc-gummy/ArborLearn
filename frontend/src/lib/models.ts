export const DEEPSEEK_MODEL_IDS = ["deepseek-v4-flash", "deepseek-v4-pro"] as const;
export const DEEPSEEK_THINKING_MODE_IDS = ["fast", "deep", "challenge"] as const;

export type DeepSeekModelId = (typeof DEEPSEEK_MODEL_IDS)[number];
export type DeepSeekThinkingModeId = (typeof DEEPSEEK_THINKING_MODE_IDS)[number];

export const DEFAULT_DEEPSEEK_MODEL_ID: DeepSeekModelId = "deepseek-v4-flash";
export const DEFAULT_DEEPSEEK_THINKING_MODE_ID: DeepSeekThinkingModeId = "deep";

export const DEEPSEEK_MODELS: readonly {
  id: DeepSeekModelId;
  label: string;
  badge: string;
  description: string;
}[] = [
  {
    id: "deepseek-v4-flash",
    label: "快速",
    badge: "Flash",
    description: "快速回答，适合日常学习和轻量追问",
  },
  {
    id: "deepseek-v4-pro",
    label: "Pro",
    badge: "Pro",
    description: "处理复杂推理、代码和长链路问题",
  },
];

export function isDeepSeekModelId(value: unknown): value is DeepSeekModelId {
  return DEEPSEEK_MODEL_IDS.includes(value as DeepSeekModelId);
}

export const DEEPSEEK_THINKING_MODES: readonly {
  id: DeepSeekThinkingModeId;
  label: string;
  description: string;
}[] = [
  {
    id: "fast",
    label: "快速",
    description: "轻量问题，立即回答",
  },
  {
    id: "deep",
    label: "深思",
    description: "学习讲解，稳健推理",
  },
  {
    id: "challenge",
    label: "攻坚",
    description: "长时推理，复杂任务",
  },
];

export function isDeepSeekThinkingModeId(value: unknown): value is DeepSeekThinkingModeId {
  return DEEPSEEK_THINKING_MODE_IDS.includes(value as DeepSeekThinkingModeId);
}
