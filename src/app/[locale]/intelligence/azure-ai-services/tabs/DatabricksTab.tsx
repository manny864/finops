import { AzureServiceTab } from "./BaseServiceTab";

export function DatabricksTab({ tenantId }: { tenantId: string }) {
  return <AzureServiceTab tenantId={tenantId} capability="databricks" />;
}
