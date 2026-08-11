import { describe, expect, it } from "bun:test";
import { CODE_ALPHABET, CODE_REGEX, generateCode } from "../../src/pairing/codes.ts";

describe("pairing code generator", () => {
  it("alphabet excludes 0 O 1 I L", () => {
    expect(CODE_ALPHABET).not.toMatch(/[01OIL]/);
    expect(CODE_ALPHABET.length).toBe(31);
  });

  it("every generated code matches the allowed alphabet regex", () => {
    for (let i = 0; i < 1000; i++) {
      const code = generateCode();
      expect(CODE_REGEX.test(code)).toBe(true);
      expect(code.length).toBe(6);
    }
  });

  it("produces no duplicates over 1000 codes", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const code = generateCode();
      expect(seen.has(code)).toBe(false);
      seen.add(code);
    }
    expect(seen.size).toBe(1000);
  });

  it("never emits a forbidden character", () => {
    for (let i = 0; i < 1000; i++) {
      const code = generateCode();
      expect(code).not.toMatch(/[01OIL]/);
    }
  });
});
