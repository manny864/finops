import { describe, it, expect } from "vitest";
import { generateApiKey } from "@/lib/publicApiAuth";

describe("publicApiAuth unit tests", () => {
  describe("generateApiKey", () => {
    it("should generate a key with pak_ prefix", () => {
      const { plaintext } = generateApiKey();
      expect(plaintext).toMatch(/^pak_(live|test)_/);
    });

    it("should generate a 32-character hex suffix after prefix", () => {
      const { plaintext } = generateApiKey();
      const parts = plaintext.split("_");
      expect(parts.length).toBe(3);
      expect(parts[2]).toMatch(/^[a-f0-9]{32}$/);
    });

    it("should generate a 64-character hash", () => {
      const { hash } = generateApiKey();
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it("should generate a 12-character prefix", () => {
      const { prefix } = generateApiKey();
      expect(prefix.length).toBe(12);
      expect(prefix).toMatch(/^pak_(live|test)_/);
    });

    it("should generate unique keys", () => {
      const key1 = generateApiKey();
      const key2 = generateApiKey();
      expect(key1.plaintext).not.toBe(key2.plaintext);
      expect(key1.hash).not.toBe(key2.hash);
    });
  });
});
