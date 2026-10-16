/**
 * Aprobaciones de Remediación — flujo de cuatro ojos y ejecución en ARM.
 *
 * Persistencia en `RemediationRequests` (extendida por la migración
 * 20260822-001). La ejecución real se apoya en `remediationService`, que ya
 * sabe borrar recursos y operar VMs; acá se agrega el snapshot previo, el
 * cambio de tier y la traza del resultado de ARM.
 *
 * RBAC Azure mínimo por acción: `Virtual Machine Contributor` para rightsize y
 * power off, `Contributor` sobre el recurso para borrarlo, `Storage Account
 * Contributor` para cambiar el tier. El rol de tenant se valida en la ruta.
 */

import Decimal from "decimal.js";
import { randomUUID } from "node:crypto";
import type { ResultSetHeader } from "mysql2";
import pool from "@/modules/storage/db";
import { getAzureCredential } from "@/lib/azure";
import { errorMessage } from "@/lib/apiErrors";
import { exigirScopesDelTenant } from "@/lib/scopeDelTenant";
import { tenantPuedeEscribirEnAzure } from "@/lib/lighthouseAccess";
import {
  DESTRUCTIVE_ACTIONS,
  REBOOT_ACTIONS,
  SNAPSHOTTABLE_ACTIONS,
  type ApprovalActionType,
  type ApprovalHistoryItem,
  type ApprovalStatus,
  type ApprovalsPayload,
  type ApprovalsSummaryMetrics,
  type ArmExecutionStatus,
  type PendingApprovalItem,
} from "@/types/azureRemediationApprovals.types";

const ARM = "https://management.azure.com";

// ─────────────────────────────────────────────────────────────────────────────
// Normalización
// ─────────────────────────────────────────────────────────────────────────────

const VALID_ACTIONS: ApprovalActionType[] = [
  "DELETE_RESOURCE",
  "RIGHTSIZE_VM",
  "CHANGE_TIER",
  "POWER_OFF",
  "PURGE_BACKUP",
];

export function normalizeActionType(raw: unknown): ApprovalActionType {
  const s = String(raw || "").trim().toUpperCase().replace(/[\s-]/g, "_");
  const match = VALID_ACTIONS.find((a) => a === s);
  if (match) return match;
  // Alias de los motores que crean peticiones con otro vocabulario.
  const aliases: Record<string, ApprovalActionType> = {
    DELETE: "DELETE_RESOURCE", PURGE_RESOURCE: "DELETE_RESOURCE", DELETE_ORPHAN: "DELETE_RESOURCE",
    DELETE_DISK: "DELETE_RESOURCE", DELETE_NIC: "DELETE_RESOURCE", DELETE_PUBLIC_IP: "DELETE_RESOURCE",
    DELETE_SNAPSHOT: "DELETE_RESOURCE",
    RIGHTSIZE: "RIGHTSIZE_VM", DOWNSIZE: "RIGHTSIZE_VM", RESIZE: "RIGHTSIZE_VM",
    MOVE_TO_COOL: "CHANGE_TIER", COOL: "CHANGE_TIER",
    STOP: "POWER_OFF", DEALLOCATE: "POWER_OFF", SHUTDOWN: "POWER_OFF",
  };
  if (Object.hasOwn(aliases, s)) return aliases[s];
  throw new Error("Unsupported remediation action.");
}

/** El enum de MySQL usa Capitalizado; el dominio usa MAYÚSCULAS. */
export function statusFromDb(raw: unknown): ApprovalStatus {
  const s = String(raw || "Pending").toLowerCase();
  if (s === "approved") return "APPROVED";
  if (s === "rejected") return "REJECTED";
  if (s === "failed") return "FAILED";
  return "PENDING";
}

export function statusToDb(status: ApprovalStatus): string {
  return status.charAt(0) + status.slice(1).toLowerCase();
}

export function toResourceTypeDisplay(type: unknown): string {
  const original = String(type || "").trim();
  if (!original) return "Recurso";
  const KNOWN: Record<string, string> = {
    "microsoft.compute/disks": "Managed Disk",
    "microsoft.compute/virtualmachines": "Virtual Machine",
    "microsoft.compute/snapshots": "Snapshot",
    "microsoft.storage/storageaccounts": "Storage Account",
    "microsoft.network/publicipaddresses": "Public IP",
    "microsoft.network/networkinterfaces": "Network Interface",
    "microsoft.web/serverfarms": "App Service Plan",
    "microsoft.recoveryservices/vaults": "Recovery Services Vault",
  };
  const known = KNOWN[original.toLowerCase()];
  if (known) return known;
  const last = original.split("/").pop() || original;
  return last
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[\s_-]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function isDestructive(action: ApprovalActionType): boolean {
  return DESTRUCTIVE_ACTIONS.includes(action);
}

export function requiresReboot(action: ApprovalActionType): boolean {
  return REBOOT_ACTIONS.includes(action);
}

export function canSnapshot(action: ApprovalActionType, resourceType: unknown): boolean {
  // Sólo tiene sentido sobre discos gestionados: un snapshot de una NIC o de
  // una IP pública no existe, y prometerlo daría una falsa sensación de red.
  return (
    SNAPSHOTTABLE_ACTIONS.includes(action) &&
    String(resourceType || "").toLowerCase().includes("microsoft.compute/disks")
  );
}

/** Extrae del ARM ID lo que la fila pueda no tener guardado. */
export function extractFromResourceId(resourceId: unknown): {
  subscriptionId: string;
  resourceGroup: string;
  resourceType: string;
  resourceName: string;
} {
  const id = String(resourceId || "");
  const sub = id.match(/\/subscriptions\/([^/]+)/i)?.[1] || "";
  const rg = id.match(/\/resourceGroups\/([^/]+)/i)?.[1] || "";
  const providerMatch = id.match(/\/providers\/([^/]+\/[^/]+)\/([^/]+)$/i);
  return {
    subscriptionId: sub,
    resourceGroup: rg,
    resourceType: providerMatch?.[1] || "",
    resourceName: providerMatch?.[2] || id.split("/").pop() || "",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Mapeo de filas
// ─────────────────────────────────────────────────────────────────────────────

/** Fila cruda de `RemediationRequests`. */
export interface RawApprovalRow {
  id: number | string;
  resource_id?: unknown;
  resource_name?: unknown;
  resource_type?: unknown;
  resource_group?: unknown;
  subscription_id?: unknown;
  action_type?: unknown;
  action_payload_json?: unknown;
  estimated_savings?: unknown;
  status?: unknown;
  requested_by?: unknown;
  requested_at?: unknown;
  resolved_by?: unknown;
  resolved_at?: unknown;
  rejection_reason?: unknown;
  arm_execution_result_json?: unknown;
  backup_snapshot_id?: unknown;
}

function parseJsonField(raw: unknown): Record<string, unknown> | null {
  if (!raw) return null;
  if (typeof raw === "object") return raw as Record<string, unknown>;
  try {
    const parsed = JSON.parse(String(raw));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function toIso(value: unknown): string {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

export function mapPendingRow(
  row: RawApprovalRow,
  subscriptionNames: Map<string, string> = new Map()
): PendingApprovalItem {
  const derived = extractFromResourceId(row.resource_id);
  const action = normalizeActionType(row.action_type);
  const payload = parseJsonField(row.action_payload_json);
  const resourceType = String(row.resource_type || derived.resourceType);
  const subId = String(row.subscription_id || derived.subscriptionId);

  return {
    id: String(row.id),
    resourceId: String(row.resource_id || ""),
    resourceName: String(row.resource_name || derived.resourceName),
    resourceType,
    resourceTypeDisplay: toResourceTypeDisplay(resourceType),
    resourceGroup: String(row.resource_group || derived.resourceGroup),
    subscriptionId: subId,
    subscriptionName: subscriptionNames.get(subId.toLowerCase()) || subId,
    actionType: action,
    requestedBy: String(row.requested_by || "—"),
    requestedAt: toIso(row.requested_at),
    monthlySavingsUSD: Number(row.estimated_savings) || 0,
    requiresReboot: requiresReboot(action),
    isDestructive: isDestructive(action),
    canSnapshot: canSnapshot(action, resourceType),
    targetConfiguration: payload?.targetSku
      ? String(payload.targetSku)
      : payload?.targetTier
        ? String(payload.targetTier)
        : undefined,
    description: payload?.description ? String(payload.description) : undefined,
  };
}

export function mapHistoryRow(row: RawApprovalRow): ApprovalHistoryItem {
  const action = normalizeActionType(row.action_type);
  const arm = parseJsonField(row.arm_execution_result_json);
  const resourceType = String(row.resource_type || extractFromResourceId(row.resource_id).resourceType);
  return {
    id: String(row.id),
    resourceName: String(row.resource_name || ""),
    resourceType,
    resourceTypeDisplay: toResourceTypeDisplay(resourceType),
    actionType: action,
    monthlySavingsUSD: Number(row.estimated_savings) || 0,
    status: statusFromDb(row.status),
    resolvedBy: String(row.resolved_by || "—"),
    resolvedAt: toIso(row.resolved_at),
    rejectionReason: row.rejection_reason ? String(row.rejection_reason) : undefined,
    armExecutionStatus: arm?.status ? (String(arm.status) as ArmExecutionStatus) : undefined,
    armExecutionDetail: arm?.detail ? String(arm.detail) : undefined,
    backupSnapshotId: row.backup_snapshot_id ? String(row.backup_snapshot_id) : undefined,
  };
}

export function buildApprovalsSummary(input: {
  pendingRequests: PendingApprovalItem[];
  history: ApprovalHistoryItem[];
}): ApprovalsSummaryMetrics {
  const { pendingRequests, history } = input;
  const approved = history.filter((h) => h.status === "APPROVED");

  return {
    pendingApprovalsCount: pendingRequests.length,
    approvedCount: approved.length,
    rejectedCount: history.filter((h) => h.status === "REJECTED").length,
    failedCount: history.filter((h) => h.status === "FAILED").length,
    // Sólo cuenta el ahorro cuya ejecución ARM confirmó: una aprobación que
    // Azure rechazó no liberó un peso, y sumarla inflaría el número que se
    // reporta al negocio.
    liberatedSavingsMonthlyUSD: approved
      .filter((h) => h.armExecutionStatus === "Succeeded" || !h.armExecutionStatus)
      .reduce((a, h) => a.plus(h.monthlySavingsUSD), new Decimal(0))
      .toDecimalPlaces(2)
      .toNumber(),
    pendingSavingsMonthlyUSD: pendingRequests
      .reduce((a, p) => a.plus(p.monthlySavingsUSD), new Decimal(0))
      .toDecimalPlaces(2)
      .toNumber(),
    pendingRequests: [...pendingRequests].sort((a, b) => b.monthlySavingsUSD - a.monthlySavingsUSD),
    history: [...history].sort((a, b) => (b.resolvedAt || "").localeCompare(a.resolvedAt || "")),
  };
}

export function assembleLiveApprovals(input: {
  pendingRequests: PendingApprovalItem[];
  history: ApprovalHistoryItem[];
}): ApprovalsPayload {
  try {
    return {
      summary: buildApprovalsSummary(input),
      source: "live",
      lastUpdated: new Date().toISOString(),
    };
  } catch (error) {
    console.error("[azureRemediationApprovals] assembleLiveApprovals:", errorMessage(error));
    return {
      summary: buildApprovalsSummary({ pendingRequests: [], history: [] }),
      source: "live",
      lastUpdated: new Date().toISOString(),
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Ejecución en ARM
// ─────────────────────────────────────────────────────────────────────────────

export interface ArmExecutionResult {
  status: ArmExecutionStatus;
  detail: string;
  snapshotId?: string;
}

class ArmOperationPendingError extends Error {}

/** Never label an accepted asynchronous mutation (or incomplete backup) as applied. */
async function requireCompletedArmResponse(response: Response, snapshot = false): Promise<void> {
  if (response.status === 202 || response.headers.has("azure-asyncoperation") || response.headers.has("operation-location")) {
    throw new ArmOperationPendingError(snapshot
      ? "Azure accepted the protective snapshot; completion requires reconciliation. Resource deletion was NOT attempted."
      : "Azure accepted an asynchronous operation; completion requires reconciliation. Do not resubmit.");
  }
  if (response.status === 204 || response.status === 404) return;
  const text = await response.clone().text();
  if (!text && !snapshot) return;
  const data = JSON.parse(text);
  const state = data?.properties?.provisioningState ?? data?.status;
  if (state && String(state).toLowerCase() !== "succeeded") {
    if (["failed", "canceled", "cancelled"].includes(String(state).toLowerCase())) {
      throw new Error("Azure reports the operation did not succeed.");
    }
    throw new ArmOperationPendingError(snapshot
      ? "Protective snapshot is not complete. Resource deletion was NOT attempted; reconcile the snapshot."
      : "Azure operation is still running; reconcile before any retry.");
  }
  if (snapshot && String(state).toLowerCase() !== "succeeded") {
    throw new Error("Azure did not confirm protective snapshot completion; resource deletion was NOT attempted.");
  }
}

/** API version por tipo de recurso para el DELETE genérico y los PATCH. */
const API_VERSIONS: Record<string, string> = {
  "microsoft.compute/disks": "2023-01-02",
  "microsoft.compute/snapshots": "2023-01-02",
  "microsoft.compute/virtualmachines": "2023-09-01",
  "microsoft.storage/storageaccounts": "2023-01-01",
  "microsoft.network/publicipaddresses": "2023-05-01",
  "microsoft.network/networkinterfaces": "2023-05-01",
};

function apiVersionFor(resourceType: string): string {
  const version = API_VERSIONS[resourceType.toLowerCase()];
  if (!version) throw new Error("Unsupported resource type for remediation.");
  return version;
}

export function validateApprovalTarget(item: PendingApprovalItem): void {
  const action = normalizeActionType(item.actionType);
  const match = /^\/subscriptions\/([0-9a-f-]{36})\/resourceGroups\/([^/]+)\/providers\/([^/]+\/[^/]+)\/([^/]+)$/i.exec(item.resourceId);
  if (!match || /[\\?#%\x00-\x1f\x7f]/.test(item.resourceId)) throw new Error("Invalid remediation resource ID.");
  const expected = [item.subscriptionId, item.resourceGroup, item.resourceType, item.resourceName];
  if (expected.some((value, index) => value.toLowerCase() !== match[index + 1].toLowerCase())) {
    throw new Error("Remediation target fields do not match its resource ID.");
  }
  const type = item.resourceType.toLowerCase();
  apiVersionFor(type);
  if ((action === "RIGHTSIZE_VM" || action === "POWER_OFF") && type !== "microsoft.compute/virtualmachines") {
    throw new Error("VM action requires a virtual machine.");
  }
  if (action === "CHANGE_TIER"
    && (type !== "microsoft.storage/storageaccounts" || !["Hot", "Cool", "Cold"].includes(item.targetConfiguration || ""))) {
    throw new Error("Tier action requires a storage account and an explicit supported tier.");
  }
  if (action === "RIGHTSIZE_VM" && !/^[a-z0-9_]+$/i.test(item.targetConfiguration || "")) {
    throw new Error("Resize action requires an explicit valid SKU.");
  }
  if (action === "PURGE_BACKUP" && type !== "microsoft.compute/snapshots") {
    throw new Error("Only managed snapshots are supported by this backup purge action.");
  }
}

/**
 * Snapshot de seguridad de un disco antes de borrarlo. Es la red que hace
 * reversible una acción que de otro modo no lo es; si falla, el borrado NO
 * sigue adelante — el operador pidió explícitamente la protección.
 */
async function createDiskSnapshot(
  tenantId: string,
  subscriptionId: string,
  resourceGroup: string,
  diskId: string,
  diskName: string,
  location: string
): Promise<string> {
  const credential = await getAzureCredential(tenantId);
  const token = await credential.getToken(`${ARM}/.default`);
  if (!token?.token) throw new Error("No se pudo obtener token de ARM para el snapshot");

  const snapshotName = `${diskName.slice(0, 60)}-presnap-${Date.now().toString(36)}`;
  const url = `${ARM}/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.Compute/snapshots/${snapshotName}?api-version=2023-01-02`;

  const res = await fetch(url, {
    method: "PUT",
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
    headers: { Authorization: `Bearer ${token.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      location,
      properties: { creationData: { createOption: "Copy", sourceResourceId: diskId } },
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`No se pudo crear el snapshot previo (${res.status}): ${text.slice(0, 200)}`);
  }
  await requireCompletedArmResponse(res, true);
  const data = await res.json();
  if (typeof data.id !== "string") throw new Error("Azure snapshot response did not include a resource ID.");
  return data.id;
}

/** Cambia el tier de acceso de una Storage Account (Hot → Cool / Cold). */
async function changeStorageTier(
  tenantId: string,
  resourceId: string,
  targetTier: string
): Promise<void> {
  const credential = await getAzureCredential(tenantId);
  const token = await credential.getToken(`${ARM}/.default`);
  if (!token?.token) throw new Error("No se pudo obtener token de ARM");

  if (!["Hot", "Cool", "Cold"].includes(targetTier)) throw new Error("Unsupported storage tier.");
  const res = await fetch(`${ARM}${resourceId}?api-version=2023-01-01`, {
    method: "PATCH",
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
    headers: { Authorization: `Bearer ${token.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ properties: { accessTier: targetTier } }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Azure rechazó el cambio de tier (${res.status}): ${text.slice(0, 300)}`);
  }
  await requireCompletedArmResponse(res);
}

/** Cambia el tamaño de una VM. Azure la reinicia como parte de la operación. */
async function resizeVirtualMachine(tenantId: string, resourceId: string, targetSku: string): Promise<void> {
  const credential = await getAzureCredential(tenantId);
  const token = await credential.getToken(`${ARM}/.default`);
  if (!token?.token) throw new Error("No se pudo obtener token de ARM");

  const res = await fetch(`${ARM}${resourceId}?api-version=2023-09-01`, {
    method: "PATCH",
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
    headers: { Authorization: `Bearer ${token.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ properties: { hardwareProfile: { vmSize: targetSku } } }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Azure rechazó el redimensionamiento (${res.status}): ${text.slice(0, 300)}`);
  }
  await requireCompletedArmResponse(res);
}

async function deleteViaArm(tenantId: string, resourceId: string, resourceType: string): Promise<void> {
  const credential = await getAzureCredential(tenantId);
  const token = await credential.getToken(`${ARM}/.default`);
  if (!token?.token) throw new Error("No se pudo obtener token de ARM");

  const res = await fetch(`${ARM}${resourceId}?api-version=${apiVersionFor(resourceType)}`, {
    method: "DELETE",
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
    headers: { Authorization: `Bearer ${token.token}` },
  });
  // 204 y 404 son éxito: el recurso ya no está, que es el objetivo.
  if (!res.ok && res.status !== 204 && res.status !== 404) {
    const text = await res.text().catch(() => "");
    throw new Error(`Azure rechazó el borrado (${res.status}): ${text.slice(0, 300)}`);
  }
  await requireCompletedArmResponse(res);
}

/**
 * Ejecuta la acción aprobada contra ARM. Devuelve siempre un resultado
 * estructurado en vez de lanzar: el llamador necesita persistir el detalle del
 * fallo para que el historial distinga una aprobación aplicada de una que Azure
 * rechazó.
 */
export async function executeApprovedAction(
  tenantId: string,
  item: PendingApprovalItem,
  options: { createBackupSnapshot?: boolean; location?: string } = {}
): Promise<ArmExecutionResult> {
  try {
    validateApprovalTarget(item);
    await exigirScopesDelTenant(tenantId, [item.resourceId]);
    const permission = await tenantPuedeEscribirEnAzure(tenantId);
    if (!permission.puede) throw new Error("Tenant delegation does not authorize Azure writes.");
    let snapshotId: string | undefined;

    if (options.createBackupSnapshot && !canSnapshot(item.actionType, item.resourceType)) {
      throw new Error("This resource/action cannot create a protective snapshot.");
    }
    if (options.createBackupSnapshot) {
      snapshotId = await createDiskSnapshot(
        tenantId,
        item.subscriptionId,
        item.resourceGroup,
        item.resourceId,
        item.resourceName,
        options.location || "eastus"
      );
    }

    switch (item.actionType) {
      case "DELETE_RESOURCE":
      case "PURGE_BACKUP":
        await deleteViaArm(tenantId, item.resourceId, item.resourceType);
        break;
      case "RIGHTSIZE_VM": {
        if (!item.targetConfiguration) {
          return {
            status: "Failed",
            detail:
              "La petición no declara el SKU destino. Sin él no se puede redimensionar sin adivinar el tamaño, así que no se ejecuta.",
          };
        }
        await resizeVirtualMachine(tenantId, item.resourceId, item.targetConfiguration);
        break;
      }
      case "CHANGE_TIER":
        await changeStorageTier(tenantId, item.resourceId, item.targetConfiguration!);
        break;
      case "POWER_OFF": {
        const { deallocateVirtualMachine } = await import("@/services/remediationService");
        await deallocateVirtualMachine(tenantId, "approval-flow", item.subscriptionId, item.resourceGroup, item.resourceName);
        break;
      }
      default:
        throw new Error("Unsupported remediation action.");
    }

    return {
      status: "Succeeded",
      // Registro de auditoria que se persiste: queda en ingles, como las
      // respuestas literales de ARM que lo acompanan en el historial.
      detail: `${item.actionType} applied to ${item.resourceName}.`,
      snapshotId,
    };
  } catch (e) {
    if (e instanceof ArmOperationPendingError) return { status: "Running", detail: e.message };
    return { status: "Failed", detail: errorMessage(e) || "Unknown error executing the action on Azure" };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Persistencia
// ─────────────────────────────────────────────────────────────────────────────

export async function listApprovals(tenantId: string): Promise<RawApprovalRow[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [rows]: any = await pool.query(
    `SELECT * FROM RemediationRequests WHERE tenant_id = ? ORDER BY requested_at DESC LIMIT 500`,
    [tenantId]
  );
  return (rows as RawApprovalRow[]) || [];
}

export async function resolveApproval(
  tenantId: string,
  id: string,
  status: ApprovalStatus,
  resolvedBy: string,
  extras: { rejectionReason?: string; armResult?: ArmExecutionResult; executionToken?: string } = {}
): Promise<boolean> {
  const [result] = await pool.query<ResultSetHeader>(
    `UPDATE RemediationRequests
     SET status = ?, resolved_at = CURRENT_TIMESTAMP, resolved_by = ?,
         rejection_reason = ?, arm_execution_result_json = ?, backup_snapshot_id = ?
     WHERE id = ? AND tenant_id = ? AND status = 'Pending'
       AND (arm_execution_result_json IS NULL
            OR JSON_UNQUOTE(JSON_EXTRACT(arm_execution_result_json, '$.executionToken')) = ?)`,
    [
      statusToDb(status),
      resolvedBy,
      extras.rejectionReason || null,
      extras.armResult ? JSON.stringify({ status: extras.armResult.status, detail: extras.armResult.detail }) : null,
      extras.armResult?.snapshotId || null,
      id,
      tenantId,
      extras.executionToken || null,
    ]
  );
  return Number(result?.affectedRows || 0) > 0;
}

/** Durable claim BEFORE ARM. Interrupted executions stay claimed for manual reconciliation. */
export async function claimApprovalExecution(
  tenantId: string,
  id: string,
  resolver: string,
  expected: RawApprovalRow,
): Promise<string | null> {
  const executionToken = randomUUID();
  const [result] = await pool.query<ResultSetHeader>(
    `UPDATE RemediationRequests
     SET arm_execution_result_json = ?
     WHERE id = ? AND tenant_id = ? AND status = 'Pending'
       AND arm_execution_result_json IS NULL
       AND LOWER(TRIM(requested_by)) <> LOWER(TRIM(?))
       AND resource_id <=> ? AND action_type <=> ?
       AND action_payload_json <=> CAST(? AS JSON) AND subscription_id <=> ?
       AND resource_group <=> ? AND resource_type <=> ? AND resource_name <=> ?`,
    [
      JSON.stringify({ status: "Running", executionToken, startedAt: new Date().toISOString(), resolvedBy: resolver }),
      id, tenantId, resolver, expected.resource_id ?? null, expected.action_type ?? null,
      typeof expected.action_payload_json === "object" && expected.action_payload_json !== null
        ? JSON.stringify(expected.action_payload_json) : expected.action_payload_json ?? null,
      expected.subscription_id ?? null, expected.resource_group ?? null,
      expected.resource_type ?? null, expected.resource_name ?? null,
    ],
  );
  return result.affectedRows === 1 ? executionToken : null;
}

export async function getApprovalById(tenantId: string, id: string): Promise<RawApprovalRow | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [rows]: any = await pool.query(
    `SELECT * FROM RemediationRequests WHERE tenant_id = ? AND id = ? LIMIT 1`,
    [tenantId, id]
  );
  return ((rows as RawApprovalRow[]) || [])[0] || null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Dataset demo
// ─────────────────────────────────────────────────────────────────────────────

function tierOf(tenantId: string): "Professional" | "Business" | "Enterprise" {
  if (tenantId.includes("4444") || tenantId.includes("enterprise")) return "Enterprise";
  if (tenantId.includes("2222") || tenantId.includes("business")) return "Business";
  return "Professional";
}

const DEMO_SUB = { id: "ec03e8ce-ceee-4638-b303-64ae431d5b1e", name: "CSCS-LandingZone" };

const DEMO_PENDING: Array<
  Omit<PendingApprovalItem, "resourceTypeDisplay" | "requiresReboot" | "isDestructive" | "canSnapshot" | "subscriptionName" | "description"> & {
    descriptionKey: string;
  }
> = [
  {
    id: "1001",
    resourceId: `/subscriptions/${DEMO_SUB.id}/resourceGroups/rg-storage/providers/Microsoft.Compute/disks/orphan-disk-01`,
    resourceName: "orphan-disk-01",
    resourceType: "microsoft.compute/disks",
    resourceGroup: "rg-storage",
    subscriptionId: DEMO_SUB.id,
    actionType: "DELETE_RESOURCE",
    requestedBy: "advisor-bot@demo.local",
    requestedAt: "2026-08-21T14:20:00.000Z",
    monthlySavingsUSD: 78.4,
    descriptionKey: "mockDesc_orphan_disk_01",
  },
  {
    id: "1002",
    resourceId: `/subscriptions/${DEMO_SUB.id}/resourceGroups/rg-dev/providers/Microsoft.Compute/virtualMachines/vm-dev-04`,
    resourceName: "vm-dev-04",
    resourceType: "microsoft.compute/virtualmachines",
    resourceGroup: "rg-dev",
    subscriptionId: DEMO_SUB.id,
    actionType: "RIGHTSIZE_VM",
    requestedBy: "rightsizing-engine",
    requestedAt: "2026-08-21T09:05:00.000Z",
    monthlySavingsUSD: 142.1,
    targetConfiguration: "Standard_D4s_v5",
    descriptionKey: "mockDesc_vm_dev_04",
  },
  {
    id: "1003",
    resourceId: `/subscriptions/${DEMO_SUB.id}/resourceGroups/rg-data/providers/Microsoft.Storage/storageAccounts/salogsarchive`,
    resourceName: "salogsarchive",
    resourceType: "microsoft.storage/storageaccounts",
    resourceGroup: "rg-data",
    subscriptionId: DEMO_SUB.id,
    actionType: "CHANGE_TIER",
    requestedBy: "storage-optimizer",
    requestedAt: "2026-08-20T18:40:00.000Z",
    monthlySavingsUSD: 34.8,
    targetConfiguration: "Cool",
    descriptionKey: "mockDesc_salogsarchive",
  },
];

const DEMO_HISTORY: ApprovalHistoryItem[] = [
  {
    id: "901", resourceName: "nic-huerfana-12", resourceType: "microsoft.network/networkinterfaces",
    resourceTypeDisplay: "Network Interface", actionType: "DELETE_RESOURCE", monthlySavingsUSD: 4.2,
    status: "APPROVED", resolvedBy: "mchavez@ctrl365.com", resolvedAt: "2026-08-19T11:32:00.000Z",
    armExecutionStatus: "Succeeded",
  },
  {
    id: "902", resourceName: "sabackupviejo", resourceType: "microsoft.storage/storageaccounts",
    resourceTypeDisplay: "Storage Account", actionType: "CHANGE_TIER", monthlySavingsUSD: 65,
    status: "APPROVED", resolvedBy: "mchavez@ctrl365.com", resolvedAt: "2026-08-18T16:10:00.000Z",
    armExecutionStatus: "Succeeded",
  },
  {
    id: "903", resourceName: "vm-qa-integracion", resourceType: "microsoft.compute/virtualmachines",
    resourceTypeDisplay: "Virtual Machine", actionType: "POWER_OFF", monthlySavingsUSD: 28.6,
    status: "REJECTED", resolvedBy: "cloudops@cscloudsolutions.com.ar", resolvedAt: "2026-08-17T09:45:00.000Z",
    rejectionReason: "Carga en pico de pruebas de regresión hasta fin de mes.",
  },
  {
    id: "904", resourceName: "disk-datos-legacy", resourceType: "microsoft.compute/disks",
    resourceTypeDisplay: "Managed Disk", actionType: "DELETE_RESOURCE", monthlySavingsUSD: 52.3,
    status: "FAILED", resolvedBy: "mchavez@ctrl365.com", resolvedAt: "2026-08-16T13:22:00.000Z",
    armExecutionStatus: "Failed",
    armExecutionDetail: "Azure rechazó el borrado (409): el disco tiene un lease activo de una VM detenida.",
    backupSnapshotId: "/subscriptions/.../snapshots/disk-datos-legacy-presnap-m8x2",
  },
];

export function getMockApprovalsPayload(tenantId: string): ApprovalsPayload {
  const tier = tierOf(tenantId);
  const pendingCount = tier === "Enterprise" ? 3 : tier === "Business" ? 2 : 1;
  const historyCount = tier === "Enterprise" ? 4 : tier === "Business" ? 3 : 2;

  const pendingRequests: PendingApprovalItem[] = DEMO_PENDING.slice(0, pendingCount).map((p) => ({
    ...p,
    subscriptionName: DEMO_SUB.name,
    resourceTypeDisplay: toResourceTypeDisplay(p.resourceType),
    requiresReboot: requiresReboot(p.actionType),
    isDestructive: isDestructive(p.actionType),
    canSnapshot: canSnapshot(p.actionType, p.resourceType),
  }));

  return {
    summary: buildApprovalsSummary({ pendingRequests, history: DEMO_HISTORY.slice(0, historyCount) }),
    source: "mock",
    lastUpdated: "2026-08-22T09:00:00.000Z",
  };
}
