// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const { conn } = vi.hoisted(() => ({
    conn: { beginTransaction: vi.fn(), query: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn() },
}));
vi.mock("@/modules/storage/db", () => ({ default: { getConnection: async () => conn } }));

import { eliminarPerspectiva } from "@/services/perspectivesData.service";

beforeEach(() => { vi.resetAllMocks(); });

describe("perspective deletion preserves assigned scopes", () => {
    it("locks the tenant parent before checking assignments and rejects without deleting", async () => {
        conn.query.mockResolvedValueOnce([[{ id: 7 }]]).mockResolvedValueOnce([[{ perspective_id: 7 }]]);
        await expect(eliminarPerspectiva("tenant", 7)).rejects.toMatchObject({ status: 409, code: "PERSPECTIVE_IN_USE" });
        expect(conn.query.mock.calls).toEqual([
            ["SELECT id FROM Perspectives WHERE id = ? AND tenant_id = ? FOR UPDATE", [7, "tenant"]],
            ["SELECT perspective_id FROM UserScopes WHERE perspective_id = ? LIMIT 1 FOR UPDATE", [7]],
        ]);
        expect(conn.rollback).toHaveBeenCalledOnce();
        expect(conn.commit).not.toHaveBeenCalled();
        expect(conn.release).toHaveBeenCalledOnce();
    });
    it("deletes only an owned unassigned perspective and commits", async () => {
        conn.query.mockResolvedValueOnce([[{ id: 7 }]]).mockResolvedValueOnce([[]]).mockResolvedValueOnce([{ affectedRows: 1 }]);
        expect(await eliminarPerspectiva("tenant", 7)).toBe(true);
        expect(conn.query).toHaveBeenLastCalledWith("DELETE FROM Perspectives WHERE id = ? AND tenant_id = ?", [7, "tenant"]);
        expect(conn.commit).toHaveBeenCalledOnce();
        expect(conn.rollback).not.toHaveBeenCalled();
        expect(conn.release).toHaveBeenCalledOnce();
    });
    it("returns not found without consulting assignments or deleting", async () => {
        conn.query.mockResolvedValueOnce([[]]);
        expect(await eliminarPerspectiva("tenant", 7)).toBe(false);
        expect(conn.query).toHaveBeenCalledTimes(1);
        expect(conn.commit).toHaveBeenCalledOnce();
        expect(conn.release).toHaveBeenCalledOnce();
    });
    it("rolls back and propagates an assignment lookup error", async () => {
        const error = new Error("Synthetic SQL outage");
        conn.query.mockResolvedValueOnce([[{ id: 7 }]]).mockRejectedValueOnce(error);
        await expect(eliminarPerspectiva("tenant", 7)).rejects.toBe(error);
        expect(conn.rollback).toHaveBeenCalledOnce();
        expect(conn.commit).not.toHaveBeenCalled();
        expect(conn.release).toHaveBeenCalledOnce();
    });
});
