// Only explicitly configured distributions opt out of Codex behavior.
export function configuredHost(value: string | undefined): "codex" | "claude-desktop" | "cursor" | "vscode" {
  if (value === undefined || value === "codex") return "codex";
  if (value === "claude-desktop" || value === "cursor" || value === "vscode") return value;
  throw new Error("Unsupported Mobile Dev host.");
}
