import { AzureServiceTab } from "./BaseServiceTab";

export function DocumentIntelligenceTab({ tenantId }: { tenantId: string }) {
  return <AzureServiceTab tenantId={tenantId} capability="document-intelligence" />;
}
