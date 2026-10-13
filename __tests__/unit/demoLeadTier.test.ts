import { describe, it, expect } from "vitest";
import { tierDeDemo } from "@/lib/demoLeadTier";

describe("tierDeDemo", () => {
    it("acepta los tiers del catálogo", () => {
        expect(tierDeDemo("Professional")).toBe("Professional");
        expect(tierDeDemo("Business")).toBe("Business");
        expect(tierDeDemo("Enterprise")).toBe("Enterprise");
    });

    it("descarta todo lo demás: el valor llega del navegador y va a un mail", () => {
        expect(tierDeDemo("enterprise")).toBeNull();
        expect(tierDeDemo("<script>alert(1)</script>")).toBeNull();
        expect(tierDeDemo(undefined)).toBeNull();
        expect(tierDeDemo({ toString: () => "Business" })).toBeNull();
    });
});
