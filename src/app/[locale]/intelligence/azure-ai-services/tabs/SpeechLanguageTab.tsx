import { AzureServiceTab } from "./BaseServiceTab";

export function SpeechLanguageTab({ tenantId }: { tenantId: string }) {
  return <AzureServiceTab tenantId={tenantId} capability="speech-language" />;
}
