import { z } from "zod";

export const RepoOverview = z.object({
  title: z.string().describe("Short name of the project"),
  summary: z.string().describe("One or two sentences on what the project does"),
  layers: z
    .array(z.object({ id: z.string(), name: z.string() }))
    .describe(
      "2 to 6 architectural layers, top (user-facing) to bottom (infrastructure), e.g. UI, API, Domain, Data, Infra, Tooling",
    ),
  features: z
    .array(
      z.object({
        id: z.string().describe("lowercase slug"),
        name: z.string(),
        summary: z.string().describe("What this feature does for users or the system, one sentence"),
        layer: z.string().describe("id of its layer"),
        paths: z.array(z.string()).describe("Directories or files (repo-relative, as listed) that implement it"),
      }),
    )
    .describe("4 to 9 features or capabilities, together covering the important code"),
  suggestions: z
    .array(z.object({ label: z.string(), prompt: z.string() }))
    .describe("2 to 3 things the user may want to explore next"),
});
export type RepoOverview = z.infer<typeof RepoOverview>;

export const FeatureBreakdown = z.object({
  components: z
    .array(
      z.object({
        id: z.string().describe("lowercase slug"),
        name: z.string(),
        summary: z.string().describe("Its responsibility, one sentence"),
        files: z.array(z.string()).describe("Files from the given list that belong to it"),
        citations: z
          .array(z.object({ path: z.string(), line: z.number(), note: z.string() }))
          .describe("1 to 3 key locations, e.g. the main entry function"),
      }),
    )
    .describe("2 to 8 components"),
});
export type FeatureBreakdown = z.infer<typeof FeatureBreakdown>;

export type RepoContext = { owner: string; repo: string; sha: string; branch?: string; subpath?: string };
