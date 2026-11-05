# **TITLE**

An interactive flow diagram built with [React Flow](https://reactflow.dev) (`@xyflow/react`).

## Run it

Requires Node.js 20 or newer.

```sh
npm start
```

This installs dependencies, starts a dev server and opens the diagram in your browser.

## Edit the diagram

- Nodes and edges live in `src/flow.ts`.
- Node shapes are rendered by `src/nodes/ShapeNode.tsx`.
- `npm run build` produces a static site in `dist/`.
