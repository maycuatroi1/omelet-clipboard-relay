#!/usr/bin/env bun
// Static guard for invariant `no-payload-logging`.
//
// Scans src/**/*.ts for logger or console calls that pass a payload-bearing
// key (`payload`, `ciphertext`, `body`, `bytes`, `chunk`) inline as an object
// literal. Catches the obvious 3am bug: `logger.info("got chunk", { chunk })`.
// The runtime guard in src/observability/logger.ts is the second layer; this
// is the cheap first layer that fails the build before any test runs.
//
// Not a full AST. The plan permits regex for v1: a match starts at a log
// method call, opens an object literal, and contains a banned key followed by
// `:`. Comments are stripped first so doc examples like the one in logger.ts
// do not trip the check.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "src");
const BANNED = ["payload", "ciphertext", "body", "bytes", "chunk"];
const BANNED_ALT = BANNED.join("|");

const LOG_METHOD = "(?:debug|info|warn|error|log)";
const LINE_PATTERN = new RegExp(
  `(?:logger|console)\\.${LOG_METHOD}\\([^)]*?\\{[^}]*\\b(?:${BANNED_ALT})\\s*:`,
);

// Multi-line variant: object literal opens on one line, banned key appears on
// a later line before the matching close brace. Window of up to 400 chars to
// keep false positives down. Crude but sufficient for this codebase.
const MULTI_PATTERN = new RegExp(
  `(?:logger|console)\\.${LOG_METHOD}\\([\\s\\S]{0,400}?\\{[^}]*\\b(?:${BANNED_ALT})\\s*:`,
  "g",
);

function stripComments(source: string): string {
  // Remove block comments then line comments. String-literal `//` (e.g. a
  // URL) is rare in flagged positions and would only false-negative a
  // comment-shaped violation, which we do not write here.
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

function scanFile(filePath: string): Array<{ line: number; text: string }> {
  const raw = readFileSync(filePath, "utf8");
  const stripped = stripComments(raw);
  const rawLines = raw.split(/\r?\n/);
  const strippedLines = stripped.split(/\r?\n/);

  const flagged = new Set<number>();

  // Pass 1: single-line violations.
  for (let i = 0; i < strippedLines.length; i++) {
    if (LINE_PATTERN.test(strippedLines[i])) {
      flagged.add(i);
    }
  }

  // Pass 2: multi-line violations. Map the match back to the line of the
  // log-method call by counting newlines before the match start.
  const re = new RegExp(MULTI_PATTERN, "g");
  let m = re.exec(stripped);
  while (m !== null) {
    const lineNum = stripped.slice(0, m.index).split(/\r?\n/).length - 1;
    flagged.add(lineNum);
    m = re.exec(stripped);
  }

  return [...flagged]
    .sort((a, b) => a - b)
    .map((ln) => ({ line: ln + 1, text: (rawLines[ln] ?? "").trim() }));
}

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  const stack: string[] = [dir];
  while (stack.length > 0) {
    const cur = stack.pop();
    if (!cur) continue;
    const stats = statSync(cur);
    if (stats.isDirectory()) {
      for (const e of readdirSync(cur, { withFileTypes: true })) {
        stack.push(join(cur, e.name));
      }
    } else if (cur.endsWith(".ts")) {
      out.push(cur);
    }
  }
  return out;
}

function main(): void {
  const files = listTsFiles(ROOT).sort();
  const violations: Array<string> = [];
  for (const file of files) {
    for (const hit of scanFile(file)) {
      const rel = file.replace(/\\/g, "/").replace(/^.*\/src\//, "src/");
      violations.push(`${rel}:${hit.line}: ${hit.text}`);
    }
  }

  if (violations.length > 0) {
    // biome-ignore lint/suspicious/noConsole: check failure output
    console.error(
      `check:no-payload-log: FAIL - ${violations.length} logger/console call(s) pass a payload-bearing key (payload|ciphertext|body|bytes|chunk).`,
    );
    for (const v of violations) {
      // biome-ignore lint/suspicious/noConsole: check failure output
      console.error(`  ${v}`);
    }
    // biome-ignore lint/suspicious/noConsole: check failure output
    console.error(
      "  invariant: no-payload-logging - payload bytes never reach a log line, trace span, or error report.",
    );
    process.exit(1);
  }

  // biome-ignore lint/suspicious/noConsole: check success output
  console.log(`check:no-payload-log: PASS - ${files.length} src file(s) scanned, no banned keys.`);
  process.exit(0);
}

main();
