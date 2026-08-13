import { AzureServiceTab } from "./BaseServiceTab";

export function AzureSearchTab({ tenantId }: { tenantId: string }) {
  return <AzureServiceTab tenantId={tenantId} capability="search" />;
}
