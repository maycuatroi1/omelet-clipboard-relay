import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  type LogEntry,
  type LogSink,
  _setMinLevel,
  _setSink,
  logger,
  _reset as resetLogger,
} from "../../src/observability/logger.ts";
import { beforeSend } from "../../src/observability/sentry.ts";
import { _setRateLimit, _reset as resetBuffers } from "../../src/relay/buffers.ts";
import { resetBuffers as resetRoute } from "../../src/relay/route.ts";
import { type Harness, closeQuiet, nextMessage, openWs, startServer } from "./helpers.ts";

const TRANSFER_ID = "00000000-0000-4000-8000-000000000001";
const SENTINEL = "SENTINEL_PAYLOAD_BYTES";

// All captured log entries for the duration of the test. The leak assertion
// walks every recorded entry plus every serialized form.
const captured: LogEntry[] = [];
let captureSink: LogSink | null = null;

function captureAllEntries(entry: LogEntry): void {
  captured.push(entry);
  // Mirror to the real console for debug visibility while the test runs.
  captureSink?.(entry);
}

function assertNoSentinelAnywhere(context: string): void {
  const forms = [SENTINEL, Buffer.from(SENTINEL).toString("base64")];
  for (const entry of captured) {
    const serialized = JSON.stringify(entry);
    for (const form of forms) {
      if (serialized.includes(form)) {
        throw new Error(
          `${context}: payload sentinel '${form}' leaked into log entry: ${serialized}`,
        );
      }
    }
  }
}

describe("no-payload-logging invariant", () => {
  let harness: Harness | null = null;

  beforeEach(() => {
    resetBuffers();
    resetRoute();
    _setRateLimit(1_000_000, 1_000_000);
    captured.length = 0;
    captureSink = null;
    _setSink(captureAllEntries);
    _setMinLevel("debug");
  });

  afterEach(() => {
    if (harness) {
      harness.stop();
      harness = null;
    }
    resetBuffers();
    resetRoute();
    resetLogger();
    captured.length = 0;
    captureSink = null;
  });

  it("logger throws when called with a payload-bearing context key", () => {
    expect(() => logger.info("oops", { payload: "x" })).toThrow(/payload-bearing key 'payload'/);
    expect(() => logger.info("oops", { ciphertext: "x" })).toThrow(
      /payload-bearing key 'ciphertext'/,
    );
    expect(() => logger.info("oops", { bytes: "x" })).toThrow(/payload-bearing key 'bytes'/);
    expect(() => logger.info("oops", { body: "x" })).toThrow(/payload-bearing key 'body'/);
    expect(() => logger.info("oops", { chunk: "x" })).toThrow(/payload-bearing key 'chunk'/);
    expect(() => logger.info("oops", { data: "x" })).toThrow(/payload-bearing key 'data'/);
    expect(() => logger.info("oops", { content: "x" })).toThrow(/payload-bearing key 'content'/);
  });

  it("logger accepts safe metadata keys (transferId, seq, total, code)", () => {
    expect(() =>
      logger.debug("relay chunk forwarded", { transferId: TRANSFER_ID, seq: 0, total: 1 }),
    ).not.toThrow();
    expect(captured).toHaveLength(1);
  });

  it("logger filters by min level", () => {
    _setMinLevel("warn");
    logger.debug("should drop");
    logger.info("should drop");
    logger.warn("should pass");
    logger.error("should pass");
    expect(captured).toHaveLength(2);
    expect(captured[0]?.level).toBe("warn");
    expect(captured[1]?.level).toBe("error");
  });

  it("does not leak chunk bytes during a full relay transfer + ack", async () => {
    harness = startServer();

    // Build a 16 KB chunk whose decoded bytes contain the sentinel. The
    // base64 form lands in the JSON message; if any logger call ever
    // serializes the chunk object the base64 form shows up in the captured
    // entry, which assertNoSentinelAnywhere catches.
    const rawBytes = Buffer.alloc(16 * 1024, 0x41);
    rawBytes.write(SENTINEL, 0, "utf8");
    const chunkB64 = rawBytes.toString("base64");

    const sender = await openWs(harness, "/relay/AAAAAA");
    const receiver = await openWs(harness, "/relay/AAAAAA");

    sender.send(
      JSON.stringify({
        kind: "relay.chunk",
        transferId: TRANSFER_ID,
        seq: 0,
        total: 1,
        bytes: chunkB64,
      }),
    );

    const received = await nextMessage(receiver, 2000);
    const decoded = JSON.parse(received) as { kind: string; bytes?: string };
    expect(decoded.kind).toBe("relay.chunk");
    // Sanity: the chunk actually carried the sentinel - otherwise the leak
    // assertion is vacuous.
    expect(decoded.bytes).toBeDefined();
    const roundTripped = Buffer.from(decoded.bytes ?? "", "base64");
    expect(roundTripped.subarray(0, SENTINEL.length).toString("utf8")).toBe(SENTINEL);

    sender.send(JSON.stringify({ kind: "relay.ack", transferId: TRANSFER_ID, seq: 0 }));

    // Drain any ack frames so the relay pipeline runs to completion.
    await nextMessage(receiver, 2000).catch(() => {});

    // Let the warn-on-invalid-frame path emit at least one log entry too, so
    // the assertion covers multiple log sites in the relay route.
    sender.send("this is not json");
    await nextMessage(sender, 2000).catch(() => {});

    // Give the event loop a tick to flush any pending microtasks.
    await new Promise((resolve) => setTimeout(resolve, 50));

    // The relay route emitted a `relay chunk forwarded` debug log with
    // metadata only. Prove the test actually captured something.
    expect(captured.length).toBeGreaterThan(0);
    const sawForwarded = captured.some(
      (e) => e.message === "relay chunk forwarded" && e.context?.transferId === TRANSFER_ID,
    );
    expect(sawForwarded).toBe(true);

    assertNoSentinelAnywhere("relay transfer");

    closeQuiet(sender);
    closeQuiet(receiver);
  });

  it("beforeSend scrubs payload-bearing fields from Sentry events", () => {
    const event = {
      extra: { payload: "x", ciphertext: "y", keepMe: true, body: "z", bytes: "w" },
      breadcrumbs: [
        { message: "got payload: AAAA", data: { ciphertext: "secret", ok: 1 } },
        { message: "no leak here", data: { foo: "bar" } },
      ],
      request: { body: "raw bytes here" },
      exception: {
        values: [
          {
            stacktrace: {
              frames: [{ vars: { payload: "leak", locals: 3 } }, { vars: { ok: true } }],
            },
          },
        ],
      },
    };

    const out = beforeSend(event);

    expect(out.extra?.payload).toBe("__REDACTED__");
    expect(out.extra?.ciphertext).toBe("__REDACTED__");
    expect(out.extra?.body).toBe("__REDACTED__");
    expect(out.extra?.bytes).toBe("__REDACTED__");
    expect(out.extra?.keepMe).toBe(true);

    expect(out.breadcrumbs?.[0]?.message).toBe("got payload=__REDACTED__");
    expect(out.breadcrumbs?.[0]?.data?.ciphertext).toBe("__REDACTED__");
    expect(out.breadcrumbs?.[0]?.data?.ok).toBe(1);
    expect(out.breadcrumbs?.[1]?.data?.foo).toBe("bar");

    expect(out.request?.body).toBe("__REDACTED__");

    const frame0 = out.exception?.values?.[0]?.stacktrace?.frames?.[0]?.vars;
    expect(frame0?.payload).toBe("__REDACTED__");
    expect(frame0?.locals).toBe(3);
    const frame1 = out.exception?.values?.[0]?.stacktrace?.frames?.[1]?.vars;
    expect(frame1?.ok).toBe(true);
  });

  it("beforeSend passes through events with nothing to scrub", () => {
    const event = {
      extra: { ok: 1 },
      breadcrumbs: [{ message: "clean", data: { foo: "bar" } }],
      request: { url: "https://example.com" },
    };
    const out = beforeSend(event);
    expect(out).toEqual(event);
  });

  it("beforeSend handles missing optional fields without throwing", () => {
    const out = beforeSend({});
    expect(out).toEqual({});
  });
});
