import "server-only";
import { z } from "zod";
import { FlowSpec } from "../schema";
import type { ModelId } from "../models";
import { CONVERT_PROMPT } from "./prompts";
import { AgentError, runAgent, userTurn, type Usage } from "./run";

export type ImageMediaType = "image/png" | "image/jpeg" | "image/webp" | "image/gif";
export const IMAGE_TYPES: readonly ImageMediaType[] = ["image/png", "image/jpeg", "image/webp", "image/gif"];

export type ConvertInput =
  { kind: "image"; mediaType: ImageMediaType; base64: string; notes?: string } | { kind: "text"; text: string };

const SCHEMA = z.toJSONSchema(FlowSpec, { target: "draft-7" }) as Record<string, unknown>;

export async function convertDiagram(
  input: ConvertInput,
  model: ModelId,
  signal?: AbortSignal,
): Promise<{ spec: FlowSpec; usage: Usage }> {
  const prompt =
    input.kind === "image"
      ? userTurn([
          { type: "image", source: { type: "base64", media_type: input.mediaType, data: input.base64 } },
          {
            type: "text",
            text: "Convert the diagram in this image." + (input.notes ? `\n\n<notes>${input.notes}</notes>` : ""),
          },
        ])
      : `Convert this diagram source.\n\n<diagram_source>\n${input.text}\n</diagram_source>`;

  const { structured, usage } = await runAgent({
    prompt,
    systemPrompt: CONVERT_PROMPT,
    model,
    effort: "medium",
    outputSchema: SCHEMA,
    maxTurns: 4,
    maxBudgetUsd: 2,
    signal,
  });
  const parsed = FlowSpec.safeParse(structured);
  if (!parsed.success)
    throw new AgentError("Claude returned output that did not match the diagram schema.", 502, usage);
  return { spec: parsed.data, usage };
}
