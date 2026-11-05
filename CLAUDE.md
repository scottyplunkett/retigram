@AGENTS.md

# Retigram

## Commits

- Keep commits small: one logical change each.
- The message is a single imperative line, e.g. `Add place_node op`. Add a body only when the line can't carry the context, and then as short bullet points, never paragraphs.
- Before every commit run `npm run check` (format check, lint, typecheck, unit tests). Commit only when it passes. Never skip or disable a check to get a commit through.

## Code

- Format with Prettier (`npm run format`, config in `.prettierrc.json`). Lint with ESLint (`npm run lint`, config in `eslint.config.mjs`). A rule may be disabled only on a single line, with a comment saying why.
- TypeScript is strict. Avoid `any`.
- Keep logic pure in `lib/` and cover it with unit tests in `tests/`. Add or update tests with every behaviour change.
- Node components live in `export-template/src/nodes/` and ship inside exported projects. Server code imports only `@nodes/constants` and `@nodes/types` from there, never the `@nodes` barrel (it pulls in React context).
- Don't run `npm install` inside `export-template/`: the app imports its node components, and a second React copy breaks them.

## Commands

| Command                                       | What it does                                                      |
| --------------------------------------------- | ----------------------------------------------------------------- |
| `npm run dev`                                 | Dev server on port 3000                                           |
| `npm run check`                               | Format check, lint, typecheck, unit tests                         |
| `npm run format`                              | Rewrite files with Prettier                                       |
| `npm run test:export`                         | Export a project from a running server, then install and build it |
| `npm run smoke:agent`, `npm run eval:convert` | Live checks that make small Claude API calls on your key          |
