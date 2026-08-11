#!/usr/bin/env bun
import { readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://clipboard:clipboard@localhost:5432/clipboard";

const ALLOWLIST_PATH = join(import.meta.dir, "schema-allowlist.json");

type Allowlist = {
  tables: Record<string, string[]>;
};

const allowlist: Allowlist = JSON.parse(readFileSync(ALLOWLIST_PATH, "utf8"));

type Row = { table_name: string };
type ColumnRow = { table_name: string; column_name: string };

async function main() {
  const client = postgres(DATABASE_URL, { max: 1 });

  try {
    const tables = await client<Row[]>`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name;
    `;

    const columns = await client<ColumnRow[]>`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
      ORDER BY table_name, ordinal_position;
    `;

    await client.end();

    const actualTables = new Set(tables.map((r) => r.table_name));
    const allowedTables = new Set(Object.keys(allowlist.tables));

    const actualColumnsByTable = new Map<string, Set<string>>();
    for (const r of columns) {
      if (!actualColumnsByTable.has(r.table_name)) {
        actualColumnsByTable.set(r.table_name, new Set());
      }
      actualColumnsByTable.get(r.table_name)?.add(r.column_name);
    }

    const diffs: string[] = [];

    const missingTables = [...allowedTables].filter((t) => !actualTables.has(t)).sort();
    for (const t of missingTables) {
      diffs.push(`- table missing: ${t}`);
    }

    const extraTables = [...actualTables].filter((t) => !allowedTables.has(t)).sort();
    for (const t of extraTables) {
      diffs.push(`+ table extra:  ${t}`);
    }

    for (const [table, allowedCols] of Object.entries(allowlist.tables)) {
      if (!actualTables.has(table)) continue;
      const actualCols = actualColumnsByTable.get(table) ?? new Set<string>();
      const allowed = new Set(allowedCols);

      const missingCols = [...allowed].filter((c) => !actualCols.has(c)).sort();
      for (const c of missingCols) {
        diffs.push(`- column missing: ${table}.${c}`);
      }

      const extraCols = [...actualCols].filter((c) => !allowed.has(c)).sort();
      for (const c of extraCols) {
        diffs.push(`+ column extra:  ${table}.${c}`);
      }
    }

    if (diffs.length > 0) {
      // biome-ignore lint/suspicious/noConsole: check failure output
      console.error(
        `check:schema-allowlist: FAIL - database schema does not match allowlist (${diffs.length} diff(s)):`,
      );
      for (const line of diffs) {
        // biome-ignore lint/suspicious/noConsole: check failure output
        console.error(`  ${line}`);
      }
      // biome-ignore lint/suspicious/noConsole: check failure output
      console.error(
        `  allowlist: ${ALLOWLIST_PATH}\n  invariant: no-payload-columns (only users and devices tables allowed; no payload columns)`,
      );
      process.exit(1);
    }

    // biome-ignore lint/suspicious/noConsole: check success output
    console.log(
      `check:schema-allowlist: PASS - ${allowedTables.size} table(s) matched exactly (${columns.length} column(s))`,
    );
    process.exit(0);
  } catch (err) {
    await client.end().catch(() => {});
    // biome-ignore lint/suspicious/noConsole: check error output
    console.error("check:schema-allowlist: error", err);
    process.exit(1);
  }
}

main();
