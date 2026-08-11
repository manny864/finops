import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";
import { isBlobStorageEnabled, uploadBlob, downloadBlob, deleteBlob } from "@/lib/azureBlobStorage";

export const EXECUTIVE_REPORT_RETENTION_DAYS = 90;
export const EXECUTIVE_REPORT_CONTAINER =
  process.env.AZURE_STORAGE_CONTAINER_EXECUTIVE_REPORTS || "executive-reports";

const STORED_NAME_RE = /^[0-9a-f-]{36}\.md$/i;

function getExecutiveReportUploadDir(): string {
  return process.env.EXECUTIVE_REPORT_UPLOAD_DIR || path.join(process.cwd(), "data", "executive-reports");
}

export async function saveExecutiveReportMarkdown(markdown: string): Promise<string> {
  const storedName = `${crypto.randomUUID()}.md`;
  const bytes = Buffer.from(markdown, "utf-8");
  if (isBlobStorageEnabled()) {
    await uploadBlob(EXECUTIVE_REPORT_CONTAINER, storedName, bytes, "text/markdown; charset=utf-8");
    return storedName;
  }
  const dir = getExecutiveReportUploadDir();
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, storedName), bytes, { mode: 0o600 });
  return storedName;
}

export async function readExecutiveReportMarkdown(storedName: string): Promise<string | null> {
  if (!STORED_NAME_RE.test(storedName)) return null;
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

export async function deleteExecutiveReportMarkdown(storedName: string): Promise<void> {
  if (!STORED_NAME_RE.test(storedName)) return;
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
