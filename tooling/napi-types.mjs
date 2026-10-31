import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// napi-derive records each #[napi] item's TypeScript shape while it expands the
// crate. These are the item kinds the iOS capture addon uses.
function indent(lines) {
  return lines.split("\n").map(line => line.trim()).filter(Boolean).map(line => `  ${line}`).join("\n");
}

function documentation(item) {
  return item.js_doc ? `${item.js_doc.trimEnd()}\n` : "";
}

export function renderTypeDefinitions(text, source) {
  const items = text.split("\n").filter(Boolean).map(line => JSON.parse(line));
  const methods = new Map(items.filter(item => item.kind === "impl").map(item => [item.name, item.def]));
  const declarations = [];
  for (const item of items.toSorted((a, b) => a.name.localeCompare(b.name))) {
    if (item.kind === "impl") continue;
    const doc = documentation(item);
    if (item.kind === "interface") declarations.push(`${doc}export interface ${item.name} {\n${indent(item.def)}\n}`);
    else if (item.kind === "struct") declarations.push(`${doc}export declare class ${item.name} {\n${indent(methods.get(item.name) ?? "")}\n}`);
    else if (item.kind === "fn") declarations.push(`${doc}export declare ${item.def}`);
    else if (item.kind === "string_enum") {
      const values = [...item.def.matchAll(/=\s*('[^']*')/g)].map(match => match[1]);
      declarations.push(`${doc}export type ${item.name} = ${values.join(" | ")}`);
    } else throw new Error(`Unsupported napi type definition kind ${item.kind} for ${item.name}.`);
  }
  return `// Generated from the #[napi] items in ${source} by tooling/napi-types.mjs. Do not edit.\n\n${declarations.join("\n\n")}\n`;
}

/** Re-expands a napi crate with type collection on and writes its declarations. */
export async function writeNapiTypes({ name, crate, output, environment }) {
  const folder = await mkdtemp(join(tmpdir(), "mobile-dev-napi-types-"));
  try {
    // Type definitions are only emitted while the crate's macros expand, so force that.
    const now = new Date();
    await utimes(`packages/native/${crate}/src/lib.rs`, now, now);
    execFileSync("cargo", ["check", "--locked", "--manifest-path", "packages/native/Cargo.toml", "-p", name], {
      stdio: "inherit", env: { ...environment, NAPI_TYPE_DEF_TMP_FOLDER: folder },
    });
    const text = await readFile(join(folder, name), "utf8");
    await writeFile(resolve(output), renderTypeDefinitions(text, `packages/native/${crate}/src`));
  } finally { await rm(folder, { recursive: true, force: true }); }
}
