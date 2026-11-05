import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const root = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: /^server-only$/, replacement: root("./tests/stubs/server-only.ts") },
      { find: /^@nodes\/(.*)$/, replacement: root("./export-template/src/nodes/") + "$1" },
      { find: /^@nodes$/, replacement: root("./export-template/src/nodes/index.ts") },
      { find: /^@\//, replacement: root("./") },
    ],
  },
  test: { include: ["tests/**/*.test.ts"] },
});
