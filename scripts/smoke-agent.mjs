// Smoke test for the Agent SDK assumptions retigram relies on. Makes a few small real API calls.
// Run: node --env-file=.env.local scripts/smoke-agent.mjs
import { query, tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { deflateSync } from "node:zlib";
import path from "node:path";

const root = process.cwd();
const base = {
  settingSources: [],
  persistSession: false,
  permissionMode: "dontAsk",
  // Skips automatic session-title generation, which otherwise costs a hidden Haiku call per request.
  title: "retigram-smoke",
  cwd: path.join(root, ".retigram/sandbox"),
  env: {
    ...process.env,
    CLAUDE_CONFIG_DIR: path.join(root, ".retigram/claude"),
    CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
    CLAUDE_CODE_DISABLE_CLAUDE_MDS: "1",
    CLAUDE_AGENT_SDK_CLIENT_APP: "retigram-smoke/0.2",
  },
};

async function run(label, prompt, options) {
  const t0 = Date.now();
  let result;
  let init;
  const subagentModels = new Set();
  try {
    for await (const m of query({ prompt, options: { ...base, ...options } })) {
      if (m.type === "system" && m.subtype === "init") init = m;
      if (m.type === "assistant" && m.parent_tool_use_id) subagentModels.add(m.message.model);
      if (m.type === "result") result = m;
    }
  } catch (err) {
    console.log(`\n[${label}] THREW: ${err.message}`);
  }
  console.log(
    `\n[${label}] ${((Date.now() - t0) / 1000).toFixed(1)}s subtype=${result?.subtype} turns=${result?.num_turns} cost=$${result?.total_cost_usd?.toFixed(5)}`,
  );
  if (init) console.log(`  tools=${JSON.stringify(init.tools)} model=${init.model}`);
  if (result?.errors?.length) console.log("  errors:", result.errors);
  for (const [model, u] of Object.entries(result?.modelUsage ?? {})) {
    console.log(
      `  ${model}: in=${u.inputTokens} out=${u.outputTokens} cacheRead=${u.cacheReadInputTokens} cacheWrite=${u.cacheCreationInputTokens}`,
    );
  }
  if (subagentModels.size) console.log("  subagent models:", [...subagentModels]);
  return result;
}

// 1. Fixed overhead with no tools and a one-line system prompt, per model.
for (const model of ["claude-sonnet-5-5", "claude-haiku-5-5"]) {
  const r = await run(`overhead ${model}`, "Reply with the single word OK.", {
    model,
    tools: [],
    systemPrompt: "You are terse.",
    effort: "low",
    maxTurns: 1,
  });
  console.log("  result:", JSON.stringify(r?.result));
}
// Repeat Sonnet to see whether the prefix cache hits on a second stateless call.
await run("overhead repeat claude-sonnet-5-5", "Reply with the single word OK.", {
  model: "claude-sonnet-5-5",
  tools: [],
  systemPrompt: "You are terse.",
  effort: "low",
  maxTurns: 1,
});

// 2. Coordinator dispatching a Haiku worker that calls an in-process MCP tool.
const calls = [];
const server = createSdkMcpServer({
  name: "probe",
  version: "0.0.1",
  tools: [
    tool("record", "Record a colour choice for a node.", { nodeId: z.string(), color: z.string() }, async (args) => {
      calls.push(args);
      return { content: [{ type: "text", text: "recorded" }] };
    }),
  ],
});
await run(
  "dispatch",
  "Ask the painter agent to choose a colour for node 'start' and record it. Do not record it yourself.",
  {
    model: "claude-sonnet-5-5",
    effort: "low",
    tools: ["Agent"],
    mcpServers: { probe: server },
    allowedTools: ["mcp__probe__record"],
    systemPrompt: "You coordinate workers. Delegate work to the named agent with the Agent tool.",
    maxTurns: 6,
    agents: {
      painter: {
        description: "Chooses a colour for a node and records it with mcp__probe__record.",
        prompt:
          "Pick a pleasant hex colour for the node you are given and call mcp__probe__record once. Then reply 'done'.",
        model: "claude-haiku-5-5",
        effort: "low",
        tools: ["mcp__probe__record"],
        maxTurns: 3,
      },
    },
  },
);
console.log("  record() calls:", JSON.stringify(calls));

// 3. Image input + structured output.
function png(w, h, pixel) {
  const crc = (buf) => {
    let crcVal = 0xffffffff;
    for (const b of buf) {
      let c = (crcVal ^ b) & 0xff;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcVal = (crcVal >>> 8) ^ c;
    }
    return (crcVal ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set(pixel(x, y), y * (w * 3 + 1) + 1 + x * 3);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
const inBox = (x, y, x0, y0) => x >= x0 && x < x0 + 60 && y >= y0 && y < y0 + 40;
const img = png(300, 120, (x, y) =>
  inBox(x, y, 20, 40) || inBox(x, y, 120, 40) || inBox(x, y, 220, 40) ? [30, 30, 30] : [255, 255, 255],
);
async function* imagePrompt() {
  yield {
    type: "user",
    parent_tool_use_id: null,
    message: {
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: "image/png", data: img.toString("base64") } },
        { type: "text", text: "How many dark rectangles are in this image?" },
      ],
    },
  };
}
const schema = z.toJSONSchema(z.object({ rectangles: z.number() }), { target: "draft-7" });
const r3 = await run("image+structured", imagePrompt(), {
  model: "claude-sonnet-5-5",
  effort: "low",
  tools: [],
  systemPrompt: "You count shapes in images.",
  outputFormat: { type: "json_schema", schema },
  maxTurns: 3,
});
console.log("  structured_output:", JSON.stringify(r3?.structured_output));
