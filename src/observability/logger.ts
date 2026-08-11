// Logger that refuses to serialize payload-bearing fields. The invariant
// `no-payload-logging` exists because the easiest way to leak a clipboard at
// 3am is `logger.info("got chunk", { chunk })`. Every method accepts a message
// string plus an optional context object; if the context contains any banned
// key the call throws (v1 - fail loud in dev so the static check + tests
// catch it; prod can swap to redact later without changing the contract).
//
// Banned keys are the names a payload-bearing value would plausibly carry:
// `payload`, `ciphertext`, `body`, `bytes`, `chunk`, `data`, `content`. The
// static check in scripts/check-no-payload-log.ts bans the *literal* key
// appearance at the call site; this runtime guard bans the case where a
// caller builds a context object indirectly and the banned key sneaks in via
// spread or a variable.

export const BANNED_CONTEXT_KEYS = [
  "payload",
  "ciphertext",
  "body",
  "bytes",
  "chunk",
  "data",
  "content",
] as const;

export type BannedKey = (typeof BANNED_CONTEXT_KEYS)[number];

const BANNED_KEY_SET: ReadonlySet<string> = new Set(BANNED_CONTEXT_KEYS);

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  level: LogLevel;
  message: string;
  context?: Record<string, unknown>;
  timestamp: number;
}

export type LogSink = (entry: LogEntry) => void;

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

let minLevel: LogLevel = "info";
let sink: LogSink = defaultSink;

function defaultSink(entry: LogEntry): void {
  const line =
    entry.context === undefined
      ? `[${entry.level}] ${entry.message}`
      : `[${entry.level}] ${entry.message} ${safeSerialize(entry.context)}`;
  // Console is the production transport for v1. The lint rule is suppressed
  // here because this *is* the console wrapper.
  if (entry.level === "error" || entry.level === "warn") {
    // biome-ignore lint/suspicious/noConsole: logger transport
    console.error(line);
  } else {
    // biome-ignore lint/suspicious/noConsole: logger transport
    console.log(line);
  }
}

// safeSerialize must never emit the value of a banned key. The runtime guard
// in `emit` already rejected contexts whose own-keys are banned, but a nested
// object could still carry one. We walk one level deep and redact; deeper
// nesting is rare for log context and the runtime throw at the top level is
// the real safety net.
function safeSerialize(value: Record<string, unknown>): string {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (BANNED_KEY_SET.has(k)) {
      out[k] = "__REDACTED__";
      continue;
    }
    if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      const nested = v as Record<string, unknown>;
      const cleaned: Record<string, unknown> = {};
      for (const [nk, nv] of Object.entries(nested)) {
        cleaned[nk] = BANNED_KEY_SET.has(nk) ? "__REDACTED__" : nv;
      }
      out[k] = cleaned;
    } else {
      out[k] = v;
    }
  }
  try {
    return JSON.stringify(out);
  } catch {
    return "[unserializable]";
  }
}

function findBannedKey(context: Record<string, unknown>): BannedKey | undefined {
  for (const key of Object.keys(context)) {
    if (BANNED_KEY_SET.has(key)) {
      return key as BannedKey;
    }
  }
  return undefined;
}

function emit(level: LogLevel, message: string, context?: Record<string, unknown>): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel]) return;
  if (context !== undefined) {
    const banned = findBannedKey(context);
    if (banned !== undefined) {
      throw new Error(
        `logger.${level}: refusing to log context with payload-bearing key '${banned}' (invariant no-payload-logging). Use a non-banned key or omit the field.`,
      );
    }
  }
  sink({ level, message, context, timestamp: Date.now() });
}

export const logger = {
  debug(message: string, context?: Record<string, unknown>): void {
    emit("debug", message, context);
  },
  info(message: string, context?: Record<string, unknown>): void {
    emit("info", message, context);
  },
  warn(message: string, context?: Record<string, unknown>): void {
    emit("warn", message, context);
  },
  error(message: string, context?: Record<string, unknown>): void {
    emit("error", message, context);
  },
};

// Test-only seams. Tests capture log output by installing a sink that records
// every entry; production code never calls these.
export function _setSink(next: LogSink): void {
  sink = next;
}

export function _setMinLevel(level: LogLevel): void {
  minLevel = level;
}

export function _reset(): void {
  sink = defaultSink;
  minLevel = "info";
}

export default logger;
