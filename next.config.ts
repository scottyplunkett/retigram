import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The Agent SDK spawns a native Claude Code binary; keep it out of the bundle so it resolves at runtime.
  serverExternalPackages: ["@anthropic-ai/claude-agent-sdk"],
  // The export route reads the template from disk; make sure it ships with the server bundle.
  outputFileTracingIncludes: {
    "/api/export": ["./export-template/**/*"],
  },
  outputFileTracingExcludes: {
    "/api/export": ["./export-template/node_modules/**", "./export-template/dist/**"],
  },
};

export default nextConfig;
