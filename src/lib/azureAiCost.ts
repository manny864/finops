export type AzureAiSnapshotRow = Record<string, unknown>;

function snapshotTimestamp(row: AzureAiSnapshotRow): number {
  const raw = row.snapshotDate ?? row.snapshot_date;
  if (!raw) return 0;
  const timestamp = new Date(String(raw)).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function snapshotIdentity(row: AzureAiSnapshotRow, index: number): string {
  const resource = String(
    row.resourceId ??
      row.workspaceId ??
      row.resourceName ??
      row.workspaceName ??
      row.id ??
      `row-${index}`
  ).toLowerCase();
  const deployment = String(
    row.deploymentName ?? row.modelDeploymentName ?? ""
  ).toLowerCase();
  return `${resource}|${deployment}`;
}

/**
 * Snapshot cost fields are month-to-date accumulators. Keep only the newest
 * row per Azure resource/deployment so historical snapshots are never summed
 * as if each represented an independent charge.
 */
export function selectLatestAzureAiSnapshots<T extends AzureAiSnapshotRow>(
  rows: T[]
): T[] {
  const latest = new Map<string, { row: T; timestamp: number }>();

  rows.forEach((row, index) => {
    const identity = snapshotIdentity(row, index);
    const timestamp = snapshotTimestamp(row);
    const current = latest.get(identity);
    if (!current || timestamp >= current.timestamp) {
      latest.set(identity, { row, timestamp });
    }
  });

  return Array.from(latest.values(), ({ row }) => row);
}