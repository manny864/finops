// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import mysql, { type Pool, type RowDataPacket } from "mysql2/promise";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { decryptSecret } from "@/lib/secretCrypto";
const database = `finops_security_test_${process.pid}`;
let db: Pool;
vi.mock("@/modules/storage/db", () => ({
  default: { query: (...args: Parameters<Pool["query"]>) => db.query(...args) },
}));
vi.mock("@/lib/azure", () => ({ getAzureCredential: vi.fn() }));
import { claimApprovalExecution, getApprovalById, recordPendingApprovalExecution, resolveApproval } from "@/services/azureRemediationApprovals.service";

// Explicit local, disposable server only; never use application DB credentials.
describe.skipIf(!process.env.MYSQL_SECURITY_PORT)("real MySQL security persistence", () => {
  let admin: Pool;
  beforeAll(async () => {
    admin = mysql.createPool({ host: "127.0.0.1", user: "root", password: "", port: Number(process.env.MYSQL_SECURITY_PORT) });
    await admin.query(`CREATE DATABASE ${database}`);
    await admin.query(`CREATE USER '${database}'@'%' IDENTIFIED BY 'synthetic-test-only'`);
    await admin.query(`GRANT ALL ON ${database}.* TO '${database}'@'%'`);
    db = mysql.createPool({ host: "127.0.0.1", user: "root", password: "", port: Number(process.env.MYSQL_SECURITY_PORT), database });
    await db.query(`CREATE TABLE RemediationRequests (
      id INT PRIMARY KEY, tenant_id VARCHAR(64), status VARCHAR(32), requested_by VARCHAR(120),
      resource_id VARCHAR(512), action_type VARCHAR(64), action_payload_json JSON,
      subscription_id VARCHAR(64), resource_group VARCHAR(64), resource_type VARCHAR(100), resource_name VARCHAR(100),
      resolved_at DATETIME, resolved_by VARCHAR(120), rejection_reason TEXT,
      arm_execution_result_json JSON, backup_snapshot_id VARCHAR(512))`);
    await db.query(`INSERT INTO RemediationRequests
      (id, tenant_id, status, requested_by, resource_id, action_type, action_payload_json)
      VALUES (1, 'tenant-a', 'Pending', 'requester@example.test', '/resource-a', 'RIGHTSIZE_VM', '{"targetSku":"Standard_D2s_v5"}'),
             (2, 'tenant-b', 'Pending', 'requester@example.test', '/resource-b', 'RIGHTSIZE_VM', '{"targetSku":"Standard_D2s_v5"}')`);
    await db.query("CREATE TABLE Tenants (tenant_id VARCHAR(64) PRIMARY KEY, ai_api_key TEXT, itsm_api_key_encrypted TEXT)");
    await db.query("CREATE TABLE GlobalSettings (setting_key VARCHAR(64) PRIMARY KEY, setting_value TEXT)");
  });
  afterAll(async () => {
    await db?.end();
    if (admin) {
      await admin.query(`DROP DATABASE ${database}`);
      await admin.query(`DROP USER '${database}'@'%'`);
      await admin.end();
    }
  });
  it("only one concurrent CAS wins; another tenant, self approval and changed payload cannot claim", async () => {
    const row = (await getApprovalById("tenant-a", "1"))!;
    expect(await claimApprovalExecution("tenant-b", "1", "approver@example.test", row)).toBeNull();
    expect(await claimApprovalExecution("tenant-a", "1", " REQUESTER@EXAMPLE.TEST ", row)).toBeNull();
    expect(await claimApprovalExecution("tenant-a", "1", "approver@example.test",
      { ...row, action_payload_json: { targetSku: "Standard_D64s_v5" } })).toBeNull();
    const claims = await Promise.all(Array.from({ length: 12 }, () =>
      claimApprovalExecution("tenant-a", "1", "approver@example.test", row)));
    const winner = claims.find((token): token is string => token !== null)!;
    expect(claims.filter(Boolean)).toHaveLength(1);
    const pending = {
      status: "Running" as const, detail: "Synthetic accepted operation",
      operation: { stage: "action" as const, pollingUrl: "https://management.azure.com/synthetic-operation" },
      snapshotId: "/synthetic-snapshot",
    };
    expect(await recordPendingApprovalExecution("tenant-b", "1", winner, pending)).toBe(false);
    expect(await recordPendingApprovalExecution("tenant-a", "1", "not-owner", pending)).toBe(false);
    expect(await recordPendingApprovalExecution("tenant-a", "1", winner, pending)).toBe(true);
    const updated = (await getApprovalById("tenant-a", "1"))!.arm_execution_result_json;
    const persisted = typeof updated === "string" ? JSON.parse(updated) : updated;
    expect(persisted).toMatchObject({
      status: "Running", executionToken: winner, resolvedBy: "approver@example.test",
      detail: pending.detail, operation: pending.operation, snapshotId: pending.snapshotId,
    });
    expect(persisted.startedAt).toEqual(expect.any(String));
    expect(await resolveApproval("tenant-a", "1", "REJECTED", "other@example.test")).toBe(false);
    expect(await resolveApproval("tenant-a", "1", "APPROVED", "approver@example.test", { executionToken: "not-owner" })).toBe(false);
    expect(await resolveApproval("tenant-a", "1", "APPROVED", "approver@example.test", {
      executionToken: winner, armResult: { status: "Succeeded", detail: "synthetic" },
    })).toBe(true);
    expect(await resolveApproval("tenant-a", "1", "APPROVED", "approver@example.test", { executionToken: winner })).toBe(false);
    expect(await recordPendingApprovalExecution("tenant-a", "1", winner, pending)).toBe(false);
    expect(await getApprovalById("tenant-a", "2")).toBeNull();
  });
  const runMigration = (args: string[]) => promisify(execFile)(process.execPath,
    ["--import", "tsx", "scripts/rotate-app-secrets.ts", ...args], {
      env: {
        ...process.env, DB_HOST: "127.0.0.1", DB_PORT: process.env.MYSQL_SECURITY_PORT,
        DB_USER: database, DB_PASSWORD: "synthetic-test-only", DB_NAME: database, DB_SSL: "false",
        APP_SECRET_ENCRYPTION_KEY: "b".repeat(64), APP_SECRET_LEGACY_V1_KEY: "a".repeat(64),
      },
    });
  it("dry-run is read-only and a later corrupt row rolls back the entire apply", async () => {
    await db.query("INSERT INTO Tenants VALUES ('a', 'synthetic-ai', 'synthetic-itsm')");
    await db.query("INSERT INTO GlobalSettings VALUES ('ai_api_key', 'synthetic-global'), ('enterprise_ai_api_key', 'synthetic-enterprise')");
    expect((await runMigration(["--dry-run"])).stdout).toContain("Dry-run verified: 4 values.");
    let [rows] = await db.query<RowDataPacket[]>("SELECT ai_api_key FROM Tenants");
    expect(rows[0].ai_api_key).toBe("synthetic-ai");
    await db.query("UPDATE GlobalSettings SET setting_value='enc:v1:corrupt' WHERE setting_key='enterprise_ai_api_key'");
    await expect(runMigration(["--apply", "--backup-confirmed"])).rejects.toThrow();
    [rows] = await db.query<RowDataPacket[]>("SELECT ai_api_key FROM Tenants");
    expect(rows[0].ai_api_key).toBe("synthetic-ai");
    await db.query("UPDATE GlobalSettings SET setting_value='synthetic-enterprise' WHERE setting_key='enterprise_ai_api_key'");
    await expect(runMigration(["--apply"])).rejects.toThrow();
    expect((await runMigration(["--apply", "--backup-confirmed"])).stdout).toContain("Applied: 4 values.");
    [rows] = await db.query<RowDataPacket[]>("SELECT ai_api_key, itsm_api_key_encrypted FROM Tenants");
    process.env.APP_SECRET_ENCRYPTION_KEY = "b".repeat(64);
    expect(decryptSecret(rows[0].ai_api_key)).toBe("synthetic-ai");
    expect(decryptSecret(rows[0].itsm_api_key_encrypted)).toBe("synthetic-itsm");
  }, 30_000);
});
