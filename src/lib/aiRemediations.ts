import type { VisionVideoRemediationAction } from "@/types/azureVisionVideo.types";
import type { ContentSafetyRemediationAction } from "@/types/azureContentSafety.types";
import type { AmlRemediationAction } from "@/types/azureMachineLearning.types";
import type { DatabricksRemediationAction } from "@/types/azureDatabricks.types";
import type { SpeechLanguageRemediationAction } from "@/types/azureSpeechLanguage.types";

export function buildVisionVideoRemediationCommand(action: VisionVideoRemediationAction): {
  cli: string;
  powershell: string;
} {
  return {
    cli:
      action.commandPayload ||
      `az cognitiveservices account update --name "${action.resourceId.split("/").pop()}" --sku F0`,
    powershell: `# PowerShell Azure CLI\n${action.commandPayload || "az cognitiveservices account update --sku F0"}`,
  };
}

export const buildVisionRemediationCommand = buildVisionVideoRemediationCommand;

export function buildContentSafetyRemediationCommand(action: ContentSafetyRemediationAction): {
  cli: string;
  powershell: string;
} {
  return {
    cli:
      action.commandPayload ||
      `az cognitiveservices account update --name "${action.resourceId.split("/").pop()}" --sku F0`,
    powershell: `# PowerShell Azure CLI\n${action.commandPayload || "az cognitiveservices account update --sku F0"}`,
  };
}

export function buildAmlRemediationCommand(action: AmlRemediationAction): {
  cli: string;
  powershell: string;
} {
  return {
    cli:
      action.commandPayload ||
      `az ml compute update --name "${action.resourceId.split("/").pop()}"`,
    powershell: `# PowerShell / Azure CLI\n${action.commandPayload || "# Consulte Azure ML Studio"}`,
  };
}

export function buildDatabricksRemediationCommand(action: DatabricksRemediationAction): {
  cli: string;
  powershell: string;
} {
  return {
    cli:
      action.commandPayload ||
      `databricks clusters edit --json '{"cluster_id": "${action.targetId}"}'`,
    powershell: `# Ejecutar comando en Databricks CLI o Portal Web\n# https://accounts.azuredatabricks.net`,
  };
}

export function buildSpeechLanguageRemediationCommand(action: SpeechLanguageRemediationAction): {
  cli: string;
  powershell: string;
} {
  return {
    cli:
      action.commandPayload ||
      `az cognitiveservices account update --name "${action.resourceId.split("/").pop()}" --sku F0`,
    powershell: `# PowerShell Azure CLI\n${action.commandPayload || "az cognitiveservices account update --sku F0"}`,
  };
}
