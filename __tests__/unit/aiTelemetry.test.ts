// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { timeAiCall } from "@/lib/aiTelemetry";

let info: MockInstance;
const lastLine = () => JSON.parse(String(info.mock.calls.at(-1)?.[0]));

beforeEach(() => {
    info = vi.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(() => info.mockRestore());

describe("timeAiCall", () => {
    it("devuelve el resultado y registra la latencia", async () => {
        expect(await timeAiCall("anomaly-explanation", async () => 42)).toBe(42);
        expect(lastLine()).toEqual({
            evt: "ai_feature",
            feature: "anomaly-explanation",
            stage: "model",
            outcome: "ok",
            ms: expect.any(Number),
        });
    });

    it("registra el error y lo propaga", async () => {
        await expect(
            timeAiCall("anomaly-explanation", async () => {
                throw new Error("timeout");
            })
        ).rejects.toThrow("timeout");
        expect(lastLine()).toMatchObject({ stage: "model", outcome: "error" });
    });
});
