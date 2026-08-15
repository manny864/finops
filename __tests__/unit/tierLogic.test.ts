import { describe, it, expect } from "vitest";
import { hasAccess, getSubscriptionLimit, getUserLimit } from "@/lib/tierLogic";

describe("tierLogic.hasAccess", () => {
    it("Professional cannot access Business", () => {
        expect(hasAccess("Professional", "Business")).toBe(false);
    });

    it("Business can access Professional", () => {
        expect(hasAccess("Business", "Professional")).toBe(true);
    });

    it("Enterprise can access all", () => {
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

    it("fail-closed: unknown requiredTier denies access", () => {
        expect(hasAccess("Enterprise", "professsional")).toBe(false);
        expect(hasAccess("Enterprise", "")).toBe(false);
    });

    it("normalizes starter/essential (tier legacy) → Professional and unknown currentTier gets no access", () => {
        expect(hasAccess("starter", "Professional")).toBe(true);
        expect(hasAccess("essential", "Professional")).toBe(true);
        expect(hasAccess("starter", "Business")).toBe(false);
        expect(hasAccess("unknown-tier", "Professional")).toBe(false);
    });
});

describe("tierLogic limits", () => {
    it("returns correct subscription limits per tier", () => {
        expect(getSubscriptionLimit("Professional")).toBe(2);
        expect(getSubscriptionLimit("Business")).toBe(3);
        expect(getSubscriptionLimit("Enterprise")).toBe(Infinity);
        expect(getSubscriptionLimit("pro")).toBe(2);
    });

    it("returns correct user limits per tier", () => {
        expect(getUserLimit("Professional")).toBe(3);
        expect(getUserLimit("Business")).toBe(5);
        expect(getUserLimit("Enterprise")).toBe(Infinity);
        expect(getUserLimit("business")).toBe(5);
    });
});
