import { describe, expect, it } from "bun:test";
import app from "../src/app.ts";

describe("GET /health", () => {
  it("returns status ok with HTTP 200", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("ok");
  });
});
