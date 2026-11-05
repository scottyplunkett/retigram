// Client-safe usage type and helpers (lib/agent/run.ts is server-only).
export type Usage = {
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  durationMs: number;
  turns: number;
  byModel: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }>;
};

export const emptyUsage = (): Usage => ({
  costUsd: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  durationMs: 0,
  turns: 0,
  byModel: {},
});

export function addUsage(a: Usage, b: Usage): Usage {
  const byModel = { ...a.byModel };
  for (const [m, u] of Object.entries(b.byModel ?? {})) {
    const prev = byModel[m] ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    byModel[m] = {
      input: prev.input + u.input,
      output: prev.output + u.output,
      cacheRead: prev.cacheRead + u.cacheRead,
      cacheWrite: prev.cacheWrite + u.cacheWrite,
    };
  }
  return {
    costUsd: a.costUsd + b.costUsd,
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
    durationMs: Math.max(a.durationMs, b.durationMs),
    turns: a.turns + b.turns,
    byModel,
  };
}
