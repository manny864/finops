// @vitest-environment node
import mysql, { type Pool, type RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

let db: Pool;
const { mail, generate } = vi.hoisted(() => ({ mail: vi.fn(), generate: vi.fn() }));
vi.mock("@/modules/storage/db", () => ({
    default: { query: (...args: Parameters<Pool["query"]>) => db.query(...args) },
}));
vi.mock("@/lib/emailHelper", () => ({ sendEmailStrict: mail }));
vi.mock("@/services/reportRenderers.service", () => ({ GENERADORES: { synthetic: generate } }));
import { enviarSuscripcion } from "@/services/reportDispatch.service";

const database = `finops_dispatch_revocation_${process.pid}`;
const sub = {
    id: 42, tenantId: "synthetic-owner", reportType: "synthetic",
    scope: { perspectiveId: 7, grupo: "Allowed" }, recipients: ["one@example.test", "two@example.test"],
};
const report = { asunto: "Synthetic", html: "Allowed", csv: "Allowed,10\n", filas: 1 };

describe.skipIf(!process.env.MYSQL_SECURITY_PORT)("scheduled dispatch revocation with real MySQL", () => {
    let admin: Pool;
    beforeAll(async () => {
        const connection = { host: "127.0.0.1", user: "root", password: "",
            port: Number(process.env.MYSQL_SECURITY_PORT) };
        admin = mysql.createPool(connection);
        await admin.query(`CREATE DATABASE ${database}`);
        db = mysql.createPool({ ...connection, database });
        await db.query(`CREATE TABLE ReportSubscriptions (
            id INT PRIMARY KEY, tenant_id VARCHAR(64), report_type VARCHAR(40),
            scope_json JSON, recipients_json JSON, active BOOLEAN, created_by VARCHAR(120), last_sent_at DATETIME)`);
        await db.query("CREATE TABLE Users (tenant_id VARCHAR(64), email VARCHAR(120), account_status VARCHAR(20))");
        await db.query("CREATE TABLE UserScopes (tenant_id VARCHAR(64), user_email VARCHAR(120), perspective_id INT, group_name VARCHAR(120))");
        await db.query("CREATE TABLE Tenants (tenant_id VARCHAR(64), company_name VARCHAR(120))");
        await db.query("INSERT INTO Tenants VALUES (?, 'Synthetic')", [sub.tenantId]);
    });
    beforeEach(async () => {
        vi.clearAllMocks();
        generate.mockReset().mockResolvedValue(report);
        mail.mockReset().mockResolvedValue(undefined);
        await db.query("DELETE FROM ReportSubscriptions");
        await db.query("DELETE FROM Users");
        await db.query("DELETE FROM UserScopes");
        await db.query(`INSERT INTO ReportSubscriptions
            (id, tenant_id, report_type, scope_json, recipients_json, active, created_by)
            VALUES (?, ?, ?, ?, ?, 1, 'author@example.test')`,
        [sub.id, sub.tenantId, sub.reportType, JSON.stringify(sub.scope), JSON.stringify(sub.recipients)]);
        await db.query("INSERT INTO Users VALUES (?, 'author@example.test', 'ACTIVE')", [sub.tenantId]);
    });
    afterAll(async () => {
        if (db) await db.end();
        if (admin) {
            await admin.query(`DROP DATABASE ${database}`);
            await admin.end();
        }
    });
    async function expectUnmarked() {
        const [rows] = await db.query<RowDataPacket[]>("SELECT last_sent_at FROM ReportSubscriptions WHERE id = ?", [sub.id]);
        expect(rows[0].last_sent_at).toBeNull();
    }
    it("matches MySQL JSON objects independent of key order, sends and marks only the owning tenant", async () => {
        const result = await enviarSuscripcion({ ...sub, scope: { grupo: "Allowed", perspectiveId: 7 } });
        expect(result.enviados).toBe(2);
        const [rows] = await db.query<RowDataPacket[]>("SELECT last_sent_at FROM ReportSubscriptions WHERE id = ?", [sub.id]);
        expect(rows[0].last_sent_at).not.toBeNull();
    });
    it("preserves SQL NULL scope without falling back on JSON null", async () => {
        await db.query("UPDATE ReportSubscriptions SET scope_json = NULL WHERE id = ?", [sub.id]);
        await enviarSuscripcion({ ...sub, scope: null });
        expect(mail).toHaveBeenCalledTimes(2);
    });
    it.each([
        { tenantId: "synthetic-foreign" }, { scope: { perspectiveId: 8, grupo: "Foreign" } },
        { recipients: ["forged@example.test"] },
    ])("rejects a stale or foreign snapshot %j before generation", async (change) => {
        await expect(enviarSuscripcion({ ...sub, ...change })).rejects.toMatchObject({ code: "REPORT_SUBSCRIPTION_CHANGED" });
        expect(generate).not.toHaveBeenCalled();
        expect(mail).not.toHaveBeenCalled();
        await expectUnmarked();
    });
    it("rejects a persisted deactivation", async () => {
        await db.query("UPDATE ReportSubscriptions SET active = 0 WHERE id = ?", [sub.id]);
        await expect(enviarSuscripcion(sub)).rejects.toMatchObject({ code: "REPORT_SUBSCRIPTION_CHANGED" });
        expect(mail).not.toHaveBeenCalled();
    });
    it("observes suspension committed during generation before sending", async () => {
        generate.mockImplementation(async () => {
            await db.query("UPDATE Users SET account_status = 'DISABLED' WHERE tenant_id = ?", [sub.tenantId]);
            return report;
        });
        await expect(enviarSuscripcion(sub)).rejects.toMatchObject({ code: "ACCOUNT_DISABLED" });
        expect(mail).not.toHaveBeenCalled();
        await expectUnmarked();
    });
    it("observes a Perspective permission assigned during generation", async () => {
        generate.mockImplementation(async () => {
            await db.query("INSERT INTO UserScopes VALUES (?, 'author@example.test', 7, 'Allowed')", [sub.tenantId]);
            return report;
        });
        await expect(enviarSuscripcion(sub)).rejects.toMatchObject({ code: "SCOPE_ROUTE_NOT_AWARE" });
        expect(mail).not.toHaveBeenCalled();
        await expectUnmarked();
    });
    it("stops recipients when the stored recipient configuration changes after first send", async () => {
        mail.mockImplementationOnce(async () => {
            await db.query("UPDATE ReportSubscriptions SET recipients_json = ? WHERE id = ?",
                [JSON.stringify(["replacement@example.test"]), sub.id]);
        });
        await expect(enviarSuscripcion(sub)).rejects.toMatchObject({ code: "REPORT_SUBSCRIPTION_CHANGED" });
        expect(mail).toHaveBeenCalledOnce();
        await expectUnmarked();
    });
});
