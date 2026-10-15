import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";
import { resolveTenantStoredName, tenantBlobPrefix, tenantStoredName } from "@/lib/tenantBlobPath";
import { isBlobStorageEnabled, uploadBlob, downloadBlob, deleteBlob } from "@/lib/azureBlobStorage";

export const EXECUTIVE_REPORT_RETENTION_DAYS = 90;
export const EXECUTIVE_REPORT_CONTAINER =
  process.env.AZURE_STORAGE_CONTAINER_EXECUTIVE_REPORTS || "executive-reports";

const STORED_NAME_RE = /^[0-9a-f-]{36}\.md$/i;

function getExecutiveReportUploadDir(): string {
  return process.env.EXECUTIVE_REPORT_UPLOAD_DIR || path.join(process.cwd(), "data", "executive-reports");
}

/** AISEC-05: se guarda en la carpeta del tenant (`<prefijo>/<uuid>.md`). */
export async function saveExecutiveReportMarkdown(tenantId: string, markdown: string): Promise<string> {
  const storedName = tenantStoredName(tenantId, `${crypto.randomUUID()}.md`);
  const bytes = Buffer.from(markdown, "utf-8");
  if (isBlobStorageEnabled()) {
    await uploadBlob(EXECUTIVE_REPORT_CONTAINER, storedName, bytes, "text/markdown; charset=utf-8");
    return storedName;
  }
  const dir = getExecutiveReportUploadDir();
  await fs.mkdir(path.join(dir, tenantBlobPrefix(tenantId)), { recursive: true, mode: 0o700 });
  await fs.writeFile(path.join(dir, storedName), bytes, { mode: 0o600 });
  return storedName;
}

export async function readExecutiveReportMarkdown(tenantId: string, rawName: string): Promise<string | null> {
  const storedName = resolveTenantStoredName(tenantId, rawName, STORED_NAME_RE);
  if (!storedName) return null;
  if (isBlobStorageEnabled()) {
    const bytes = await downloadBlob(EXECUTIVE_REPORT_CONTAINER, storedName);
    return bytes ? bytes.toString("utf-8") : null;
  }
  try {
    const bytes = await fs.readFile(path.join(getExecutiveReportUploadDir(), storedName));
    return bytes.toString("utf-8");
  } catch {
    return null;
  }
}

export async function deleteExecutiveReportMarkdown(tenantId: string, rawName: string): Promise<void> {
  const storedName = resolveTenantStoredName(tenantId, rawName, STORED_NAME_RE);
  if (!storedName) return;
  if (isBlobStorageEnabled()) {
    try {
      await deleteBlob(EXECUTIVE_REPORT_CONTAINER, storedName);
    } catch {
      // no-op best effort
    }
    return;
  }
  try {
    await fs.unlink(path.join(getExecutiveReportUploadDir(), storedName));
  } catch {
    // no-op best effort
  }
}
