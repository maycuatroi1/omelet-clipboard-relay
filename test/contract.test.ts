import { describe, expect, it } from "bun:test";
import schemaJson from "../proto/clipboard.v1.schema.json";
import { parseMessage } from "../src/proto/types.ts";

type Def = {
  channel?: string;
  properties?: { kind?: { const?: unknown } };
};
type Schema = {
  oneOf: { $ref: string }[];
  $defs: Record<string, Def>;
};

const schema = schemaJson as unknown as Schema;
const branchCount = schema.oneOf.length;

function defKind(def: Def): string | undefined {
  const c = def.properties?.kind?.const;
  return typeof c === "string" ? c : undefined;
}

const kindsByChannel: Record<string, string[]> = {};
const allKinds: string[] = [];
for (const [, def] of Object.entries(schema.$defs)) {
  if (typeof def !== "object" || def === null) continue;
  if (def.channel === undefined) continue;
  const kind = defKind(def);
  if (kind === undefined) continue;
  if (!kindsByChannel[def.channel]) kindsByChannel[def.channel] = [];
  kindsByChannel[def.channel].push(kind);
  allKinds.push(kind);
}

const UUID = "00000000-0000-4000-8000-000000000000";

const POSITIVE: Record<string, Record<string, unknown>> = {
  "session.create": { kind: "session.create", code: "ABC123" },
  "session.join": { kind: "session.join", code: "ABC123", version: "1" },
  "session.leave": { kind: "session.leave", code: "ABC123" },
  "sdp.offer": { kind: "sdp.offer", type: "offer", sdp: "v=0" },
  "sdp.answer": { kind: "sdp.answer", type: "answer", sdp: "v=0" },
  "ice.candidate": { kind: "ice.candidate", candidate: "...", sdpMid: "0", sdpMLineIndex: null },
  "relay.chunk": { kind: "relay.chunk", transferId: UUID, seq: 0, total: 1, bytes: "AA==" },
  "relay.ack": { kind: "relay.ack", transferId: UUID, seq: 0 },
  "relay.cancel": { kind: "relay.cancel", transferId: UUID, reason: "user" },
  "relay.resume": { kind: "relay.resume", transferId: UUID, fromSeq: 5 },
  "relay.error": { kind: "relay.error", code: "over-cap", message: "too big" },
  "relay.complete": { kind: "relay.complete", transferId: UUID },
  "dc.chunk": {
    kind: "dc.chunk",
    transferId: UUID,
    seq: 0,
    total: 2,
    bytes: "AA==",
    meta: { mime: "text/plain", name: "clip.txt", size: 4 },
  },
  "dc.ack": { kind: "dc.ack", transferId: UUID, seq: 1 },
  "dc.cancel": { kind: "dc.cancel", transferId: UUID, reason: "user" },
  "dc.resume": { kind: "dc.resume", transferId: UUID, fromSeq: 3 },
  "dc.error": { kind: "dc.error", code: "internal", message: "boom" },
};

const NEGATIVE: Record<string, Record<string, unknown>> = {
  "session.create": { kind: "session.create" },
  "session.join": { kind: "session.join", code: 5 },
  "session.leave": { kind: "session.leave", code: "ABC123", extra: 1 },
  "sdp.offer": { kind: "sdp.offer", type: "answer", sdp: "v=0" },
  "sdp.answer": { kind: "sdp.answer", type: "answer" },
  "ice.candidate": {
    kind: "ice.candidate",
    candidate: 5,
    sdpMid: null,
    sdpMLineIndex: null,
  },
  "relay.chunk": { kind: "relay.chunk", transferId: "nope", seq: 0, total: 1, bytes: "AA==" },
  "relay.ack": { kind: "relay.ack", transferId: UUID, seq: -1 },
  "relay.cancel": { kind: "relay.cancel", transferId: UUID },
  "relay.resume": { kind: "relay.resume", transferId: UUID, fromSeq: "x" },
  "relay.error": { kind: "relay.error", code: "nope", message: "x" },
  "relay.complete": { kind: "relay.complete" },
  "dc.chunk": { kind: "dc.chunk", transferId: UUID, seq: 0, total: 0, bytes: "AA==" },
  "dc.ack": { kind: "dc.ack", transferId: "nope", seq: 0 },
  "dc.cancel": { kind: "dc.cancel", transferId: UUID, reason: "x", foo: 1 },
  "dc.resume": { kind: "dc.resume", transferId: UUID },
  "dc.error": { kind: "dc.error", code: "internal" },
};

describe("wire protocol contract", () => {
  it("covered kind count equals schema oneOf branch count", () => {
    expect(allKinds.length).toBe(branchCount);
    expect(new Set(allKinds).size).toBe(branchCount);
  });

  for (const kind of allKinds) {
    describe(kind, () => {
      it("parses a valid sample", () => {
        const out = parseMessage(POSITIVE[kind]);
        expect(out).not.toBeNull();
        expect((out as { kind: string }).kind).toBe(kind);
      });
      it("rejects an invalid sample", () => {
        const out = parseMessage(NEGATIVE[kind]);
        expect(out).toBeNull();
      });
    });
  }

  for (const [channel, kinds] of Object.entries(kindsByChannel)) {
    it(`channel '${channel}' has every kind exercised`, () => {
      for (const kind of kinds) {
        expect(POSITIVE[kind], `positive for ${kind}`).toBeDefined();
        expect(NEGATIVE[kind], `negative for ${kind}`).toBeDefined();
      }
      expect(kinds.length).toBeGreaterThan(0);
    });
  }

  it("rejects unknown kind", () => {
    expect(parseMessage({ kind: "nope" })).toBeNull();
  });

  it("rejects non-object input", () => {
    expect(parseMessage(null)).toBeNull();
    expect(parseMessage("hello")).toBeNull();
    expect(parseMessage(42)).toBeNull();
  });

  it("rejects object missing kind", () => {
    expect(parseMessage({ code: "ABC" })).toBeNull();
  });
});
