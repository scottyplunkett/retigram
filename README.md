# Retigram

Retigram turns a picture of a diagram, a text description of one, or a GitHub repository into an interactive [React Flow](https://reactflow.dev) diagram. You can then reshape it by chatting with Claude, edit its configuration directly, and export it as a standalone project you can run anywhere.

- **Diagrams:** photograph a whiteboard, screenshot a flowchart or org chart, or paste Mermaid, DOT, ASCII art or plain prose. You get draggable, editable nodes and edges.
- **Repositories:** paste a GitHub URL. You get a map of the codebase's features in architectural layers, linked to the exact lines of source, that you can expand level by level.
- **Shared editing:** ask Claude for changes ("put the logo above Executive Branch", "colour by department"), drag things yourself, or edit the JSON. All three stay in sync.

## Quick start

### Users

You need Node.js 20 or newer and an [Anthropic API key](https://console.anthropic.com/).

```sh
git clone <this repo> retigram && cd retigram
npm install
cp .env.local.example .env.local   # paste your ANTHROPIC_API_KEY
npm run dev
```

Open http://localhost:3000. Each request runs on your own API key, and each response shows what it cost.

### Developers

```sh
npm install
cp .env.local.example .env.local
npm run dev            # http://localhost:3000
npm run check          # format check, lint, typecheck, unit tests (run before every commit)
```

Contribution rules (small single-line commits, formatting, tests) are in [CLAUDE.md](CLAUDE.md).

Optional environment variables:

| Variable            | Purpose                                                            |
| ------------------- | ------------------------------------------------------------------ |
| `ANTHROPIC_API_KEY` | Required. Used by the Claude Agent SDK.                            |
| `GITHUB_TOKEN`      | Optional. Maps private repositories and raises GitHub rate limits. |

## Features

### Input

- Image upload by drop, file picker or paste from the clipboard. Images are downscaled in the browser before upload.
- Text input: Mermaid, PlantUML, DOT, ASCII art, bullet lists or prose.
- GitHub URL input, optionally narrowed to a branch, tag or folder with `/tree/<ref>/<path>`. A GitHub URL pasted into the text box is detected automatically.

### Diagram conversion

- Nine node shapes (rectangle, rounded, diamond, ellipse, parallelogram, cylinder, document, text, group) plus nested groups for swimlanes and containers.
- Edge labels, arrowheads (none, one end, both ends) and solid, dashed or dotted lines.
- Pictures in the source that aren't nodes, such as logos or maps, are cropped from your upload into image nodes.
- Warnings list anything illegible or guessed, and suggestion buttons offer likely next edits.

### Repository maps

- A feature map: 4 to 9 features grouped into 2 to 6 architectural layers, with edges counted from real imports between them.
- Expand any node to go deeper: feature → components → files → top-level declarations. Every level links to the exact file and line on GitHub at the mapped commit.
- **Expand all** explores every feature in parallel.
- Results are cached per commit, so reopening or re-expanding is instant and free.

### Editing

- Chat with Claude to change the diagram: add, remove, relabel, restyle, move, align, order, resize, re-nest or re-layout nodes, and add illustrations.
- A coordinator handles simple edits itself and sends drawing, theming and repository exploration to cheaper worker agents, in parallel where possible.
- Drag, resize, connect, delete and double-click to rename on the canvas.
- Auto-layout in four directions.
- The **Config** panel shows the live diagram as JSON. It updates as you or Claude edit, summarises changes since the default, and accepts edited JSON after validating it.
- **Apply as default** saves the current canvas as the configuration that Export uses. **Revert** goes back to it.

### Models and cost

- Pick the coordinator model (conversion, repository overview, chat) and the worker model (illustrations, themes, repository breakdowns). The defaults are Claude Sonnet 5.5 and Claude Haiku 5.5. Claude Opus 5.5 is also available.
- Every response shows its cost, tokens and cache reads, plus a running session total.

### Export

- **Copy node definitions:** a TypeScript module with `initialNodes` and `initialEdges`.
- **Download complete project:** a Vite + React Flow app. Unzip it and run `npm start` to install, start and open it. The page shows only the diagram, and repository levels you loaded keep working offline.

## How it works

### Agents

All model calls go through the [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview) (`lib/agent/run.ts`). Each request starts a local Claude Code subprocess with built-in tools, settings files, memory and session persistence switched off, and a fixed session title so no extra title-generation call is made. Requests are stateless: the browser holds the diagram and sends it with each request.

- **Conversion** (`lib/agent/convert.ts`) is one call that returns structured output validated against a Zod schema (`lib/schema.ts`): nodes with shapes, positions and parents; edges; figures with crop boxes; suggestions; and warnings. The browser maps that to React Flow nodes (`lib/toXyflow.ts`), crops figures (`lib/crop.ts`), and runs dagre auto-layout (`lib/layout.ts`) if anything overlaps.
- **Chat edits** (`app/api/agent/route.ts`) run a coordinator with in-process MCP tools (`lib/agent/flowTools.ts`): `read_nodes`, `apply_ops`, `suggest` and, on repository maps, `expand_nodes`. The coordinator sees a compact one-line-per-node outline with absolute positions and sizes (`lib/outline.ts`), not the full JSON. It changes the diagram only through patch operations (`lib/ops.ts`), such as `add_node`, `set_style`, `place_node`, `arrange_nodes`, `set_parent` and `auto_layout`, which are validated and applied by pure functions (`lib/geometry.ts`). It can dispatch `illustrator` and `stylist` workers (`lib/agent/workers.ts`) through the SDK's subagent support.

### Sync

After every accepted change, the server streams the resulting diagram to the browser over server-sent events. The browser merges it three ways (`lib/merge.ts`): the version it sent, the live canvas, and the server's result. Agent changes win; anything you changed during the run that the agent didn't touch is kept. Image data never goes to the model; it is stripped from requests and restored on merge.

The page keeps two copies of the diagram: the live canvas, and the default configuration that Export uses. Conversions, repository maps, expansions, auto-layout and completed agent turns update the default automatically. Your own canvas edits update it only when you click **Apply as default**. The Config panel (`components/ConfigPanel.tsx`, `lib/configText.ts`) renders the live copy as JSON, diffs it against the default, and validates edited JSON (unique ids, valid parents, no cycles, no dangling edges) before applying it.

### Repository maps

The approach follows [8thlight/repo-tutor](https://github.com/8thlight/repo-tutor): scan locally first, and give the model only small, bounded slices.

1. **Fetch** (`lib/repo/github.ts`): resolve the branch or tag to a commit, download the tarball once, and extract regular files only (no symlinks; dependency and build folders are skipped; 150 MB and 20,000 file caps).
2. **Scan** (`lib/repo/analyze.ts`, no model): languages, manifests, entry points, README headings, top-level declarations with line numbers, and an import graph for JavaScript/TypeScript (including tsconfig path aliases), Python and Go. Detection is regex based and can miss dynamic imports.
3. **Overview**: a digest of the scan, about 7k tokens at most (`lib/repo/digest.ts`), goes to the coordinator model, which names the layers and features and lists their paths. Edges between features are computed from the import graph (`lib/repo/edges.ts`), not generated.
4. **Expand a feature**: a worker agent gets the feature's file list and read-only tools (`lib/repo/tools.ts`: `list_files`, `read_file` limited to 200 lines and confined to the snapshot, `find_symbol`), then returns components with file assignments and line citations. Files it doesn't assign go into an "Other files" component.
5. **Files and declarations** come straight from the scan with no model call.
6. **Cache** (`lib/repo/cache.ts`): scans, overviews and expansions are stored under `.retigram/cache/<owner>/<repo>/<sha>/`, so a new commit never serves stale results.

Repository content is treated as untrusted data in every prompt, and the agents have no tools that can write files or run commands.

### Export

`/api/export` copies `export-template/` into a zip, writes the current default configuration to `src/flow.ts`, and sets the title. The template uses the same node components as the app (`export-template/src/nodes/`), so exported projects render identically. Its `npm start` script runs `npm install` and then the Vite dev server.

## Dependencies

Runtime:

| Package                          | Used for                                                          |
| -------------------------------- | ----------------------------------------------------------------- |
| `next`, `react`, `react-dom`     | App framework, API routes and UI                                  |
| `@xyflow/react`                  | Interactive diagram canvas                                        |
| `@anthropic-ai/claude-agent-sdk` | Agent runtime: coordinator, workers, MCP tools, structured output |
| `@anthropic-ai/sdk`              | Peer dependency of the Agent SDK                                  |
| `zod`                            | Schemas for structured output, tool inputs and ops                |
| `@dagrejs/dagre`                 | Automatic layout, including nested groups                         |
| `jszip`                          | Building the exported project zip                                 |
| `tar`                            | Extracting GitHub repository tarballs                             |
| `server-only`                    | Keeps server modules out of client bundles                        |

Development:

| Package                                                  | Used for      |
| -------------------------------------------------------- | ------------- |
| `typescript`, `@types/*`                                 | Type checking |
| `vitest`                                                 | Unit tests    |
| `eslint`, `eslint-config-next`, `eslint-config-prettier` | Linting       |
| `prettier`                                               | Formatting    |

The exported project depends only on `react`, `react-dom`, `@xyflow/react` and, for development, `vite`, `@vitejs/plugin-react` and `typescript`.

## Project layout

| Path                  | Contents                                                                  |
| --------------------- | ------------------------------------------------------------------------- |
| `app/`                | Page and API routes (`convert`, `agent`, `repo`, `repo/expand`, `export`) |
| `components/`         | Input, chat, config panel, export menu, model settings, canvas            |
| `lib/agent/`          | Agent SDK wrapper, prompts, tools, workers                                |
| `lib/repo/`           | GitHub fetch, scan, digest, edges, map, cache, file tools                 |
| `lib/`                | Ops, geometry, layout, merge, outline, serialization                      |
| `export-template/`    | The downloadable project, including the shared node components            |
| `tests/`, `fixtures/` | Unit tests and test fixtures (including a small multi-language repo)      |
| `scripts/`            | Smoke test, conversion eval, export end-to-end test                       |

## Testing

```sh
npm run check            # format check, lint, typecheck, unit tests
npm run test:export      # export a project from a running server, install it and build it
npm run smoke:agent      # live: checks Agent SDK assumptions (model ids, workers, images, structured output)
npm run eval:convert     # live: runs fixtures/inputs through /api/convert (needs a running server)
```

The live scripts make small real API calls on your key.
