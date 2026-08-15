import { AzureServiceTab } from "./BaseServiceTab";

export function AMLTab({ tenantId }: { tenantId: string }) {
  return <AzureServiceTab tenantId={tenantId} capability="aml" />;
}
