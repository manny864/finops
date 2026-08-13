import { AzureServiceTab } from "./BaseServiceTab";

export function VisionVideoTab({ tenantId }: { tenantId: string }) {
  return <AzureServiceTab tenantId={tenantId} capability="vision-video" />;
}
