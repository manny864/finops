import { describe, it, expect } from "vitest";
import { hasAccess } from "@/lib/tierLogic";

describe("tierLogic.hasAccess", () => {
    it("Essential cannot access Professional", () => {
        expect(hasAccess("Essential", "Professional")).toBe(false);
    });

    it("Business can access Professional", () => {
        expect(hasAccess("Business", "Professional")).toBe(true);
    });

    it("Enterprise can access all", () => {
        expect(hasAccess("Enterprise", "Essential")).toBe(true);
        expect(hasAccess("Enterprise", "Professional")).toBe(true);
        expect(hasAccess("Enterprise", "Business")).toBe(true);
        expect(hasAccess("Enterprise", "Enterprise")).toBe(true);
    });

    it("normalizes pro → Professional", () => {
        expect(hasAccess("pro", "Professional")).toBe(true);
        expect(hasAccess("Pro", "Business")).toBe(false);
    });

    it("same tier grants access", () => {
        expect(hasAccess("Business", "Business")).toBe(true);
    });
});
