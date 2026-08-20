import type { VisionVideoRemediationAction } from "@/types/azureVisionVideo.types";
import type { ContentSafetyRemediationAction } from "@/types/azureContentSafety.types";
import type { AmlRemediationAction } from "@/types/azureMachineLearning.types";
import type { DatabricksRemediationAction } from "@/types/azureDatabricks.types";
import type { SpeechLanguageRemediationAction } from "@/types/azureSpeechLanguage.types";
import type { LogicAppRemediationAction } from "@/types/azureLogicApps.types";
import type { ApimRemediationAction } from "@/types/azureApim.types";
import type { ServiceBusRemediationAction } from "@/types/azureServiceBus.types";
import type { EventGridRemediationAction } from "@/types/azureEventGrid.types";
import type { EventHubsRemediationAction } from "@/types/azureEventHubs.types";
import type { AdfRemediationAction } from "@/types/azureDataFactory.types";
import type { AppInsightsRemediationAction } from "@/types/azureAppInsights.types";

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

export function buildLogicAppsRemediationCommand(action: LogicAppRemediationAction): {
  cli: string;
  powershell: string;
} {
  return {
    cli: action.commandPayload || `az logic workflow show --id "${action.resourceId}"`,
    powershell: `# PowerShell / Azure CLI remediation for Logic Apps\n# Resource: ${action.resourceId}\n${action.commandPayload || ""}`,
  };
}

export function buildApimRemediationCommand(action: ApimRemediationAction): {
  cli: string;
  powershell: string;
} {
  const resourceName = action.resourceName || action.resourceId.split("/").pop() || "apim-instance";
  if (action.category === "DEV_SKU_DOWNGRADE") {
    return {
      cli: action.commandPayload || `az apim update --name "${resourceName}" --resource-group "${action.resourceId.split("/")[4] || "rg"}" --sku-name Developer --sku-capacity 1`,
      powershell: `# PowerShell Azure CLI - Arbitraje a SKU Developer\nUpdate-AzApiManagement -ResourceGroupName "${action.resourceId.split("/")[4] || "rg"}" -Name "${resourceName}" -Sku Developer -Capacity 1`,
    };
  }
  if (action.category === "UNITS_RIGHTSIZING") {
    const recommendedUnits = action.recommendedCapacity || 1;
    return {
      cli: action.commandPayload || `az apim update --name "${resourceName}" --resource-group "${action.resourceId.split("/")[4] || "rg"}" --sku-capacity ${recommendedUnits}`,
      powershell: `# PowerShell Azure CLI - Rightsizing de Unidades\nUpdate-AzApiManagement -ResourceGroupName "${action.resourceId.split("/")[4] || "rg"}" -Name "${resourceName}" -Capacity ${recommendedUnits}`,
    };
  }
  return {
    cli: action.commandPayload || `# Habilitar caché de respuesta interna en políticas de APIM\naz apim api policy update --resource-group "${action.resourceId.split("/")[4] || "rg"}" --service-name "${resourceName}" --api-id "all-apis"`,
    powershell: `# PowerShell - Aplicar caché en políticas de APIM\nSet-AzApiManagementPolicy -ResourceGroupName "${action.resourceId.split("/")[4] || "rg"}" -Name "${resourceName}" -PolicyFilePath "./apim-cache-policy.xml"`,
  };
}

export function buildServiceBusRemediationCommand(action: ServiceBusRemediationAction): {
  cli: string;
  powershell: string;
} {
  const resourceName = action.resourceName || action.resourceId.split("/").pop() || "sb-namespace";
  const rg = action.resourceId.split("/")[4] || "rg-servicebus";

  if (action.category === "SKU_DOWNGRADE") {
    if (action.actionType === "REDUCE_UNITS") {
      const capacity = action.recommendedCapacity || 1;
      return {
        cli:
          action.commandPayload ||
          `az servicebus namespace update --name "${resourceName}" --resource-group "${rg}" --capacity ${capacity}`,
        powershell: `# PowerShell Azure CLI - Rightsizing de Messaging Units\nSet-AzServiceBusNamespace -ResourceGroupName "${rg}" -Name "${resourceName}" -Capacity ${capacity}`,
      };
    }
    return {
      cli:
        action.commandPayload ||
        `az servicebus namespace update --name "${resourceName}" --resource-group "${rg}" --sku Standard`,
      powershell: `# PowerShell Azure CLI - Migración a SKU Standard\nSet-AzServiceBusNamespace -ResourceGroupName "${rg}" -Name "${resourceName}" -SkuName Standard`,
    };
  }

  if (action.category === "ORPHAN_PURGE") {
    return {
      cli:
        action.commandPayload ||
        `az servicebus queue delete --name "idle-queue" --namespace-name "${resourceName}" --resource-group "${rg}"`,
      powershell: `# PowerShell - Eliminar cola huérfana\nRemove-AzServiceBusQueue -ResourceGroupName "${rg}" -NamespaceName "${resourceName}" -Name "idle-queue"`,
    };
  }

  return {
    cli:
      action.commandPayload ||
      `az servicebus queue update --name "main-queue" --namespace-name "${resourceName}" --resource-group "${rg}" --default-message-time-to-live P7D`,
    powershell: `# PowerShell - Ajustar retención de mensajes\nSet-AzServiceBusQueue -ResourceGroupName "${rg}" -NamespaceName "${resourceName}" -Name "main-queue" -DefaultMessageTimeToLive (New-TimeSpan -Days 7)`,
  };
}

export function buildEventGridRemediationCommand(action: EventGridRemediationAction): {
  cli: string;
  powershell: string;
} {
  const resourceName = action.resourceName || action.resourceId.split("/").pop() || "eg-resource";
  const rg = action.resourceId.split("/")[4] || "rg-eventgrid";

  if (action.category === "SKU_DOWNGRADE") {
    return {
      cli:
        action.commandPayload ||
        `az eventgrid domain update --name "${resourceName}" --resource-group "${rg}" --sku Basic`,
      powershell: `# PowerShell Azure CLI - Arbitraje a SKU Basic\nUpdate-AzEventGridDomain -ResourceGroupName "${rg}" -Name "${resourceName}" -Sku Basic`,
    };
  }

  return {
    cli:
      action.commandPayload ||
      `az eventgrid topic delete --name "${resourceName}" --resource-group "${rg}" --yes`,
    powershell: `# PowerShell - Eliminar tema huérfano\nRemove-AzEventGridTopic -ResourceGroupName "${rg}" -Name "${resourceName}"`,
  };
}

export function buildEventHubsRemediationCommand(action: EventHubsRemediationAction): {
  cli: string;
  powershell: string;
} {
  const resourceName = action.resourceName || action.resourceId.split("/").pop() || "eh-namespace";
  const rg = action.resourceId.split("/")[4] || "rg-eventhubs";

  if (action.category === "SKU_DOWNGRADE") {
    if (action.actionType === "REDUCE_UNITS" && action.recommendedCapacity) {
      const cap = action.recommendedCapacity;
      return {
        cli:
          action.commandPayload ||
          `az eventhubs namespace update --name "${resourceName}" --resource-group "${rg}" --capacity ${cap}`,
        powershell: `# PowerShell Azure CLI - Rightsizing de PUs/TUs\nSet-AzEventHubNamespace -ResourceGroupName "${rg}" -Name "${resourceName}" -SkuCapacity ${cap}`,
      };
    }
    return {
      cli:
        action.commandPayload ||
        `az eventhubs namespace update --name "${resourceName}" --resource-group "${rg}" --sku Standard --capacity 2`,
      powershell: `# PowerShell Azure CLI - Arbitraje a SKU Standard\nSet-AzEventHubNamespace -ResourceGroupName "${rg}" -Name "${resourceName}" -SkuName Standard -SkuCapacity 2`,
    };
  }

  if (action.category === "AUTO_INFLATE_OPTIMIZE") {
    return {
      cli:
        action.commandPayload ||
        `az eventhubs namespace update --name "${resourceName}" --resource-group "${rg}" --capacity 1 --enable-auto-inflate true --maximum-throughput-units 5`,
      powershell: `# PowerShell Azure CLI - Ajustar Auto-inflate y Capacidad Base\nSet-AzEventHubNamespace -ResourceGroupName "${rg}" -Name "${resourceName}" -SkuCapacity 1 -EnableAutoInflate $true -MaximumThroughputUnits 5`,
    };
  }

  return {
    cli:
      action.commandPayload ||
      `az eventhubs namespace delete --name "${resourceName}" --resource-group "${rg}" --yes`,
    powershell: `# PowerShell - Eliminar namespace huérfano\nRemove-AzEventHubNamespace -ResourceGroupName "${rg}" -Name "${resourceName}"`,
  };
}

export function buildAdfRemediationCommand(action: AdfRemediationAction): {
  cli: string;
  powershell: string;
} {
  const resourceName = action.resourceName || action.resourceId.split("/").pop() || "adf-factory";
  const rg = action.resourceId.split("/")[4] || "rg-datafactory";

  if (action.category === "IR_DOWNGRADE") {
    return {
      cli:
        action.commandPayload ||
        `az datafactory integration-runtime managed update --factory-name "${resourceName}" --resource-group "${rg}" --name "AutoResolveIntegrationRuntime" --time-to-live 10`,
      powershell: `# PowerShell Azure CLI - Rightsizing de Integration Runtime\nSet-AzDataFactoryV2IntegrationRuntime -ResourceGroupName "${rg}" -DataFactoryName "${resourceName}" -Name "AutoResolveIntegrationRuntime"`,
    };
  }

  if (action.category === "DATA_FLOW_CACHE_ENABLE") {
    return {
      cli:
        action.commandPayload ||
        `az datafactory integration-runtime managed update --factory-name "${resourceName}" --resource-group "${rg}" --name "Azure-AutoResolve-IR" --time-to-live 15`,
      powershell: `# PowerShell Azure CLI - Habilitar Quick Reuse & Caché Data Flow\nSet-AzDataFactoryV2IntegrationRuntime -ResourceGroupName "${rg}" -DataFactoryName "${resourceName}" -Name "Azure-AutoResolve-IR"`,
    };
  }

  return {
    cli:
      action.commandPayload ||
      `az datafactory delete --factory-name "${resourceName}" --resource-group "${rg}" --yes`,
    powershell: `# PowerShell - Eliminar Data Factory huérfana\nRemove-AzDataFactoryV2 -ResourceGroupName "${rg}" -Name "${resourceName}"`,
  };
}

export function buildAppInsightsRemediationCommand(action: AppInsightsRemediationAction): {
  cli: string;
  powershell: string;
} {
  const resourceName = action.resourceName || action.resourceId.split("/").pop() || "appi-resource";
  const rg = action.resourceId.split("/")[4] || "rg-monitoring";

  if (action.category === "SET_DAILY_CAP") {
    const cap = action.recommendedDailyCap || 5;
    return {
      cli:
        action.commandPayload ||
        `az monitor app-insights component update --app "${resourceName}" --resource-group "${rg}" --daily-cap ${cap}`,
      powershell: `# PowerShell Azure CLI - Fijar Daily Cap de Ingesta\nSet-AzApplicationInsights -ResourceGroupName "${rg}" -Name "${resourceName}" -DailyCap ${cap}`,
    };
  }

  if (action.category === "REDUCE_SAMPLING") {
    const sampling = action.recommendedSampling || 50;
    return {
      cli:
        action.commandPayload ||
        `az monitor app-insights component update --app "${resourceName}" --resource-group "${rg}" --sampling-percentage ${sampling}`,
      powershell: `# PowerShell Azure CLI - Optimizar Tasa de Muestreo (Sampling Rate)\nSet-AzApplicationInsights -ResourceGroupName "${rg}" -Name "${resourceName}" -SamplingPercentage ${sampling}`,
    };
  }

  if (action.category === "PURGE_ORPHAN") {
    return {
      cli:
        action.commandPayload ||
        `az monitor app-insights component delete --app "${resourceName}" --resource-group "${rg}" --yes`,
      powershell: `# PowerShell - Eliminar componente Application Insights huérfano\nRemove-AzApplicationInsights -ResourceGroupName "${rg}" -Name "${resourceName}"`,
    };
  }

  return {
    cli:
      action.commandPayload ||
      `# Configurar MinimumLogLevel = Warning en appsettings.json o ApplicationInsights.config`,
    powershell: `# Configurar MinimumLogLevel = Warning en appsettings.json`,
  };
}





