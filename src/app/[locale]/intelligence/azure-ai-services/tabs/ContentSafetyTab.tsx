import { AzureServiceTab } from "./BaseServiceTab";

export function ContentSafetyTab({ tenantId }: { tenantId: string }) {
  return <AzureServiceTab tenantId={tenantId} capability="content-safety" />;
}
