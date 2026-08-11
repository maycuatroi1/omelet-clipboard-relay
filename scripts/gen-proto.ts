#!/usr/bin/env bun
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..");
const SCHEMA_PATH = join(REPO_ROOT, "proto", "clipboard.v1.schema.json");
const OUT_PATH = join(REPO_ROOT, "src", "proto", "types.ts");

type Prop = {
  type?: string | string[];
  const?: unknown;
  enum?: unknown[];
  $ref?: string;
  properties?: Record<string, Prop>;
  required?: string[];
  additionalProperties?: boolean;
  minimum?: number;
  maxLength?: number;
  pattern?: string;
  description?: string;
};

type Def = Prop & { channel?: string };

type Schema = {
  $id?: string;
  $schema?: string;
  title?: string;
  description?: string;
  oneOf?: { $ref: string }[];
  $defs?: Record<string, Def>;
} & Prop;

function refName(ref: string): string {
  return ref.replace(/^#\/\$defs\//, "");
}

function pascal(name: string): string {
  return name
    .split(".")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join("");
}

function primitive(type: string): string {
  if (type === "string") return "string";
  if (type === "integer" || type === "number") return "number";
  if (type === "boolean") return "boolean";
  if (type === "null") return "null";
  return "unknown";
}

function tsType(prop: Prop): string {
  if (prop.$ref) {
    const n = refName(prop.$ref);
    return n === "uuid" || n === "base64" ? "string" : pascal(n);
  }
  if (prop.const !== undefined) return JSON.stringify(prop.const);
  if (prop.enum !== undefined) return prop.enum.map((v) => JSON.stringify(v)).join(" | ");
  if (Array.isArray(prop.type)) return prop.type.map(primitive).join(" | ");
  if (prop.type === "object") {
    const reqSet = new Set(prop.required ?? []);
    const parts: string[] = [];
    for (const [k, v] of Object.entries(prop.properties ?? {})) {
      parts.push(`${k}${reqSet.has(k) ? "" : "?"}: ${tsType(v)}`);
    }
    return `{ ${parts.join("; ")} }`;
  }
  if (prop.type) return primitive(prop.type);
  return "unknown";
}

function requiredChecks(name: string, prop: Prop): string[] {
  const path = `o.${name}`;
  const checks: string[] = [];

  if (prop.const !== undefined) {
    checks.push(`${path} !== ${JSON.stringify(prop.const)}`);
    return checks;
  }
  if (prop.enum !== undefined) {
    const list = prop.enum.map((v) => JSON.stringify(v)).join(", ");
    checks.push(`![${list}].some((v) => v === ${path})`);
    return checks;
  }
  if (prop.$ref) {
    const n = refName(prop.$ref);
    if (n === "uuid") {
      checks.push(`typeof ${path} !== "string"`);
      checks.push(`!UUID_RE.test(${path})`);
      return checks;
    }
    if (n === "base64") {
      checks.push(`typeof ${path} !== "string"`);
      checks.push(`!BASE64_RE.test(${path})`);
      if (prop.maxLength !== undefined) checks.push(`${path}.length > ${prop.maxLength}`);
      return checks;
    }
    checks.push(`!is${pascal(n)}(${path})`);
    return checks;
  }
  if (Array.isArray(prop.type)) {
    const nullOk = prop.type.includes("null");
    const nonNull = prop.type.filter((t) => t !== "null");
    const typeChecks: string[] = [];
    for (const t of nonNull) {
      if (t === "integer" || t === "number") typeChecks.push(`typeof ${path} !== "number"`);
      else if (t === "string") typeChecks.push(`typeof ${path} !== "string"`);
      else if (t === "boolean") typeChecks.push(`typeof ${path} !== "boolean"`);
    }
    if (nullOk) {
      if (typeChecks.length > 0) checks.push(`${path} !== null && ${typeChecks.join(" && ")}`);
      if (prop.type.includes("integer")) {
        checks.push(`${path} !== null && !Number.isInteger(${path})`);
        if (prop.minimum !== undefined)
          checks.push(`${path} !== null && ${path} < ${prop.minimum}`);
      }
    } else {
      for (const c of typeChecks) checks.push(c);
      if (prop.type.includes("integer")) {
        checks.push(`!Number.isInteger(${path})`);
        if (prop.minimum !== undefined) checks.push(`${path} < ${prop.minimum}`);
      }
    }
    return checks;
  }
  if (prop.type === "string") {
    checks.push(`typeof ${path} !== "string"`);
    return checks;
  }
  if (prop.type === "integer") {
    checks.push(`typeof ${path} !== "number"`);
    checks.push(`!Number.isInteger(${path})`);
    if (prop.minimum !== undefined) checks.push(`${path} < ${prop.minimum}`);
    return checks;
  }
  if (prop.type === "number") {
    checks.push(`typeof ${path} !== "number"`);
    if (prop.minimum !== undefined) checks.push(`${path} < ${prop.minimum}`);
    return checks;
  }
  if (prop.type === "boolean") {
    checks.push(`typeof ${path} !== "boolean"`);
    return checks;
  }
  if (prop.type === "object") {
    checks.push(`typeof ${path} !== "object" || ${path} === null`);
    return checks;
  }
  return checks;
}

function genInterface(defName: string, def: Def): string {
  const Name = pascal(defName);
  const props = def.properties ?? {};
  const required = new Set(def.required ?? []);
  const lines: string[] = [`export interface ${Name} {`];
  for (const [k, v] of Object.entries(props)) {
    const opt = required.has(k) ? "" : "?";
    lines.push(`  ${k}${opt}: ${tsType(v)};`);
  }
  lines.push("}");
  return lines.join("\n");
}

function genGuard(defName: string, def: Def): string {
  const Name = pascal(defName);
  const props = def.properties ?? {};
  const required = new Set(def.required ?? []);
  const kindConst = props.kind?.const;
  const lines: string[] = [`function is${Name}(x: unknown): x is ${Name} {`];
  lines.push('  if (typeof x !== "object" || x === null) return false;');
  lines.push("  const o = x as Record<string, unknown>;");
  if (typeof kindConst === "string") {
    lines.push(`  if (o.kind !== ${JSON.stringify(kindConst)}) return false;`);
  }
  for (const [k, v] of Object.entries(props)) {
    if (k === "kind") continue;
    const checks = requiredChecks(k, v);
    for (const c of checks) {
      if (required.has(k)) {
        lines.push(`  if (${c}) return false;`);
      } else {
        lines.push(`  if (o.${k} !== undefined && ${c}) return false;`);
      }
    }
  }
  if (def.additionalProperties === false && Object.keys(props).length > 0) {
    const allowed = Object.keys(props)
      .map((k) => JSON.stringify(k))
      .join(", ");
    lines.push("  for (const k of Object.keys(o)) {");
    lines.push(`    if (![${allowed}].includes(k)) return false;`);
    lines.push("  }");
  }
  lines.push("  return true;");
  lines.push("}");
  return lines.join("\n");
}

function generate(): string {
  const schema: Schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf8"));
  const defs = schema.$defs ?? {};
  const oneOf = schema.oneOf ?? [];

  const orderedDefNames: string[] = [];
  for (const ref of oneOf) orderedDefNames.push(refName(ref.$ref));
  for (const [name, def] of Object.entries(defs)) {
    if (!orderedDefNames.includes(name) && def.type === "object" && def.properties) {
      orderedDefNames.push(name);
    }
  }

  const out: string[] = [];
  out.push("// AUTO-GENERATED by scripts/gen-proto.ts from proto/clipboard.v1.schema.json.");
  out.push("// Do not edit by hand. Run `bun run gen:proto` to regenerate.");
  out.push("");
  out.push(
    "const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;",
  );
  out.push("const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;");
  out.push("");

  for (const name of orderedDefNames) {
    const def = defs[name];
    if (def && def.type === "object" && def.properties) {
      out.push(genInterface(name, def));
      out.push("");
    }
  }

  const unionNames = oneOf.map((o) => pascal(refName(o.$ref)));
  out.push("export type ClipboardMessage =");
  for (let i = 0; i < unionNames.length; i++) {
    const last = i === unionNames.length - 1;
    out.push(`  | ${unionNames[i]}${last ? ";" : ""}`);
  }
  out.push("");

  for (const name of orderedDefNames) {
    const def = defs[name];
    if (def && def.type === "object" && def.properties) {
      out.push(genGuard(name, def));
      out.push("");
    }
  }

  out.push("export function parseMessage(input: unknown): ClipboardMessage | null {");
  out.push('  if (typeof input !== "object" || input === null) return null;');
  out.push("  const o = input as Record<string, unknown>;");
  out.push('  if (typeof o.kind !== "string") return null;');
  out.push("  switch (o.kind) {");
  for (const ref of oneOf) {
    const name = refName(ref.$ref);
    const def = defs[name];
    const kind = def.properties?.kind?.const;
    if (typeof kind !== "string") continue;
    const Name = pascal(name);
    out.push(`    case ${JSON.stringify(kind)}:`);
    out.push(`      return is${Name}(input) ? input : null;`);
  }
  out.push("    default:");
  out.push("      return null;");
  out.push("  }");
  out.push("}");
  out.push("");

  return out.join("\n");
}

const generated = generate();
const isCheck = process.argv.includes("--check");

if (isCheck) {
  const committed = existsSync(OUT_PATH) ? readFileSync(OUT_PATH, "utf8") : "";
  if (committed !== generated) {
    // biome-ignore lint/suspicious/noConsole: codegen CLI error output
    console.error(`gen:proto --check: ${OUT_PATH} is out of date`);
    // biome-ignore lint/suspicious/noConsole: codegen CLI error output
    console.error("run `bun run gen:proto` to regenerate.");
    process.exit(1);
  }
  // biome-ignore lint/suspicious/noConsole: codegen CLI success output
  console.log(`gen:proto --check: ${OUT_PATH} up to date`);
  process.exit(0);
}

mkdirSync(dirname(OUT_PATH), { recursive: true });
writeFileSync(OUT_PATH, generated);
// biome-ignore lint/suspicious/noConsole: codegen CLI success output
console.log(`gen:proto: wrote ${OUT_PATH}`);
