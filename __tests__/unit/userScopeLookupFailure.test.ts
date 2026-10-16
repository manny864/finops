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

    it("recovers an assignment using a bound OID when the verified email is absent", async () => {
        query.mockResolvedValue([[{ perspective_id: 7, group_name: "allowed" }]]);
        expect(await alcanceDelUsuario("tenant", "", "synthetic-oid"))
            .toEqual({ perspectiveId: 7, grupo: "allowed" });
        expect(query).toHaveBeenCalledWith(expect.stringContaining("u.tenant_id = us.tenant_id"),
            ["tenant", "", "synthetic-oid"]);
        expect(query.mock.calls[0][0]).toContain("u.entra_oid = ?");
    });

    it("checks both email and OID instead of preferring a changed email over an existing assignment", async () => {
        query.mockResolvedValue([[{ perspective_id: 7, group_name: null }]]);
        expect(await alcanceDelUsuario("tenant", "renamed@example.test", "synthetic-oid"))
            .toEqual({ perspectiveId: 7, grupo: null });
        expect(query).toHaveBeenCalledWith(expect.stringContaining("us.user_email = ? OR EXISTS"),
            ["tenant", "renamed@example.test", "synthetic-oid"]);
    });

    it("logs and rejects ambiguous assignments instead of arbitrarily picking a permission", async () => {
        query.mockResolvedValue([[{ perspective_id: 7 }, { perspective_id: 8 }]]);
        const log = vi.spyOn(console, "warn").mockImplementation(() => {});
        try {
            await expect(alcanceDelUsuario("tenant", "reader@example.test", "synthetic-oid"))
                .rejects.toThrow("Asignaciones de alcance ambiguas");
            expect(log).toHaveBeenCalled();
        } finally {
            log.mockRestore();
        }
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
