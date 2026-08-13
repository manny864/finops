import { describe, it, expect } from 'vitest';

// Copy of the improved normalizeModelKey function for testing
function normalizeModelKey(value: string): string {
    const s = String(value || "").toLowerCase().trim();
    if (!s) return "";

    // Clean meter names that have extra descriptors
    let cleaned = s
      .replace(/\s+(inp|out|tokens?|1m|1k|gl|ad)\b/gi, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-");

    // Try pattern: gpt-VERSION[-FLAVOR]
    // For cases like "5.3-codex" (no "gpt" prefix), prepend "gpt-"
    let m = cleaned.match(/^(?:gpt-)?(\d+(?:\.\d+)?(?:[a-z]+)?(?:-[a-z]+)?)/i);
    if (m) {
      const version = m[1].toLowerCase();
      return `gpt-${version}`;
    }

    // Try pattern: text-embedding-VERSION or similar compound names
    m = cleaned.match(/^([a-z]+-(?:[a-z]+-)*\d+(?:-[a-z]+)?)/i);
    if (m) {
      return m[1].toLowerCase();
    }

    // Try pattern: model-VERSION (single word + version)
    m = cleaned.match(/^([a-z]+)-(\d+(?:\.\d+)?(?:[a-z]+)?)/i);
    if (m) {
      return `${m[1]}-${m[2]}`.toLowerCase();
    }

    return cleaned.toLowerCase();
}

describe("AI Analytics Model Normalization", () => {
  describe("GPT models", () => {
    it("should normalize gpt-4 variants", () => {
      expect(normalizeModelKey("gpt-4")).toBe("gpt-4");
      expect(normalizeModelKey("gpt-4o")).toBe("gpt-4o");
      expect(normalizeModelKey("gpt-4-turbo")).toBe("gpt-4-turbo");
      expect(normalizeModelKey("GPT 4 inp")).toBe("gpt-4");
      expect(normalizeModelKey("GPT 4o inp 1M Tokens")).toBe("gpt-4o");
    });

    it("should normalize gpt-5 variants with codex/terra", () => {
      expect(normalizeModelKey("gpt-5-codex")).toBe("gpt-5-codex");
      expect(normalizeModelKey("gpt-5.3-codex")).toBe("gpt-5.3-codex");
      expect(normalizeModelKey("5.3 codex inp Gl 1M Tokens")).toBe("gpt-5.3-codex");
      expect(normalizeModelKey("5.6 terra")).toBe("gpt-5.6-terra");
    });

    it("should normalize gpt-3.5", () => {
      expect(normalizeModelKey("gpt-3.5-turbo")).toBe("gpt-3.5-turbo");
      expect(normalizeModelKey("GPT 3.5 turbo inp")).toBe("gpt-3.5-turbo");
    });
  });

  describe("Text Embedding models", () => {
    it("should normalize text-embedding models", () => {
      expect(normalizeModelKey("text-embedding-3-large")).toBe("text-embedding-3-large");
      expect(normalizeModelKey("text-embedding-ada-002")).toBe("text-embedding-ada-002");
      expect(normalizeModelKey("Text Embedding 3 Large inp")).toBe("text-embedding-3-large");
    });
  });

  describe("Other model families", () => {
    it("should normalize dall-e models", () => {
      expect(normalizeModelKey("dall-e-3")).toBe("dall-e-3");
      expect(normalizeModelKey("DALL-E 3 inp")).toBe("dall-e-3");
    });

    it("should normalize claude models", () => {
      expect(normalizeModelKey("claude-3")).toBe("claude-3");
      expect(normalizeModelKey("Claude 3 inp")).toBe("claude-3");
    });

    it("should normalize llama models", () => {
      expect(normalizeModelKey("llama-2")).toBe("llama-2");
      expect(normalizeModelKey("Llama 2 inp")).toBe("llama-2");
    });
  });

  describe("Edge cases", () => {
    it("should handle empty/null values", () => {
      expect(normalizeModelKey("")).toBe("");
      expect(normalizeModelKey(null as any)).toBe("");
      expect(normalizeModelKey("   ")).toBe("");
    });

    it("should normalize inconsistent spacing", () => {
      expect(normalizeModelKey("text   embedding   3")).toBe("text-embedding-3");
      expect(normalizeModelKey("DALL-E   3")).toBe("dall-e-3");
    });

    it("should be idempotent (normalized input -> same output)", () => {
      const normalized1 = normalizeModelKey("gpt-4o");
      const normalized2 = normalizeModelKey(normalized1);
      expect(normalized1).toBe(normalized2);

      const normalized3 = normalizeModelKey("text-embedding-3-large");
      const normalized4 = normalizeModelKey(normalized3);
      expect(normalized3).toBe(normalized4);
    });
  });
});
