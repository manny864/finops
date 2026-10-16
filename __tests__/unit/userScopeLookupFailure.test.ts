// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@/modules/storage/db", () => ({ default: { query } }));

import { alcanceDelUsuario } from "@/services/userScope.service";

beforeEach(() => { query.mockReset(); });

describe("scope lookup never turns a database failure into unrestricted access", () => {
    it("returns null only when the successful query has no assignment", async () => {
        query.mockResolvedValue([[]]);
        expect(await alcanceDelUsuario("tenant", "reader@example.test")).toBeNull();
        expect(query).toHaveBeenCalledWith(expect.stringContaining("tenant_id = ? AND user_email = ?"),
            ["tenant", "reader@example.test"]);
    });

    it("preserves an assigned perspective and group", async () => {
        query.mockResolvedValue([[{ perspective_id: 7, group_name: "allowed" }]]);
        expect(await alcanceDelUsuario("tenant", "reader@example.test"))
            .toEqual({ perspectiveId: 7, grupo: "allowed" });
    });

    it("logs and propagates query errors instead of returning null", async () => {
        const error = new Error("Synthetic SQL outage");
        query.mockRejectedValue(error);
        const log = vi.spyOn(console, "warn").mockImplementation(() => {});
        try {
            await expect(alcanceDelUsuario("tenant", "reader@example.test")).rejects.toBe(error);
            expect(log).toHaveBeenCalledWith("[userScope] no se pudo leer el alcance:", error.message);
        } finally {
            log.mockRestore();
        }
    });
});
