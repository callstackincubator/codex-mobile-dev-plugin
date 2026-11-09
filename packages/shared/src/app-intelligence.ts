import { z } from "zod";

export const intelPlatforms = ["ios", "android"] as const;
export type IntelPlatform = typeof intelPlatforms[number];
export type IntelRef = `screen:${string}` | `file:${string}` | `package:${string}`;

export type IntelFile = { fingerprint: string; kind: "source" | "asset"; reach: number };
export type IntelDiagnostic = { code: string; message: string; file?: string };
export type IntelEdge = {
  from: IntelRef;
  to: IntelRef | null;
  kind: "import" | "navigation" | "source" | "layout";
  specifier?: string;
  platforms?: IntelPlatform[];
  dynamic?: boolean;
  typeOnly?: boolean;
};
export type IntelScreen = { title: string; route: string | null; source: string | null; layouts: string[] };
export type AppIntelSnapshot = {
  formatVersion: 1;
  meta: { projectId: string; generation: string; analyzedAt: string; analyzerVersion: string; sourceFingerprint: string };
  files: Record<string, IntelFile>;
  /** Third-party dependencies, kept as leaves: `entry` is the file that resolved, not a subtree. */
  packages: Record<string, { name: string; reach: number; entry: string | null }>;
  screens: Record<string, IntelScreen>;
  edges: IntelEdge[];
  diagnostics: IntelDiagnostic[];
  indexes: { screens: Record<string, string[]>; incoming: Record<string, number[]>; outgoing: Record<string, number[]> };
};

export type AppIntelStatus = {
  projectPath: string;
  run: { runId: string; phase: "discovering" | "analyzing" | "saving"; message: string } | null;
  snapshot: Pick<AppIntelSnapshot["meta"], "analyzedAt" | "generation"> | null;
};

export const generateAppIntelInput = z.object({ projectPath: z.string().min(1).max(4096).optional() }).strict();
export const appIntelQueryInput = z.object({
  operation: z.enum(["search", "screen", "file"]),
  query: z.string().min(1).max(4096),
  projectPath: z.string().min(1).max(4096).optional(),
  direction: z.enum(["incoming", "outgoing", "both"]).default("incoming"),
  depth: z.number().int().min(0).max(3).default(1),
  offset: z.number().int().nonnegative().default(0),
  limit: z.number().int().min(1).max(100).default(30),
}).strict();
export type AppIntelQuery = z.infer<typeof appIntelQueryInput>;

export const screenRef = (id: string): IntelRef => `screen:${id}`;
export const fileRef = (path: string): IntelRef => `file:${path}`;
export const packageRef = (name: string): IntelRef => `package:${name}`;

