export const MODELS = {
  "claude-sonnet-5-5": { label: "Sonnet 5.5", note: "$2 / $10 per M tokens" },
  "claude-haiku-5-5": { label: "Haiku 5.5", note: "$0.10 / $0.50 per M tokens" },
  "claude-opus-5-5": { label: "Opus 5.5", note: "$4 / $20 per M tokens" },
} as const;

export type ModelId = keyof typeof MODELS;
export type Effort = "low" | "medium" | "high";

export type ModelChoice = { coordinator: ModelId; worker: ModelId };

export const DEFAULT_MODELS: ModelChoice = {
  coordinator: "claude-sonnet-5-5",
  worker: "claude-haiku-5-5",
};

export function isModelId(v: unknown): v is ModelId {
  return typeof v === "string" && v in MODELS;
}

/** Validate a client-supplied model choice, falling back to defaults. */
export function parseModels(v: unknown): ModelChoice {
  const o = (v ?? {}) as Partial<Record<keyof ModelChoice, unknown>>;
  return {
    coordinator: isModelId(o.coordinator) ? o.coordinator : DEFAULT_MODELS.coordinator,
    worker: isModelId(o.worker) ? o.worker : DEFAULT_MODELS.worker,
  };
}
