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
import { EH_SKU_CATEGORIES } from "@/types/azureEventHubs.types";
import type { AdfRemediationAction } from "@/types/azureDataFactory.types";
import type { AppInsightsRemediationAction } from "@/types/azureAppInsights.types";
import type { LogAnalyticsRemediationAction } from "@/types/azureLogAnalytics.types";
import type { AzureMonitorRemediationAction } from "@/types/azureMonitor.types";
import type { SentinelRemediationAction } from "@/types/azureSentinel.types";
import type { AlertRemediationAction } from "@/types/azureAlerts.types";
import type { ActionGroupRemediationAction } from "@/types/azureActionGroups.types";
import type { WorkbookRemediationAction } from "@/types/azureWorkbooks.types";
import type { NetworkWatcherRemediationAction } from "@/types/azureNetworkWatcher.types";
import type { DefenderRemediationAction } from "@/types/azureDefender.types";
import type { KeyVaultRemediationAction } from "@/types/azureKeyVault.types";
import type { EntraIdRemediationAction } from "@/types/azureEntraId.types";
import type { WafRemediationAction } from "@/types/azureWaf.types";

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
    powershell: `#{cmt_la_ps_header}\n#{cmt_la_recurso} ${action.resourceId}\n${action.commandPayload || ""}`,
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
      powershell: `#{cmt_ip_arb_developer}\nUpdate-AzApiManagement -ResourceGroupName "${action.resourceId.split("/")[4] || "rg"}" -Name "${resourceName}" -Sku Developer -Capacity 1`,
    };
  }
  if (action.category === "UNITS_RIGHTSIZING") {
    const recommendedUnits = action.recommendedCapacity || 1;
    return {
      cli: action.commandPayload || `az apim update --name "${resourceName}" --resource-group "${action.resourceId.split("/")[4] || "rg"}" --sku-capacity ${recommendedUnits}`,
      powershell: `#{cmt_ip_rightsizing_units}\nUpdate-AzApiManagement -ResourceGroupName "${action.resourceId.split("/")[4] || "rg"}" -Name "${resourceName}" -Capacity ${recommendedUnits}`,
    };
  }
  return {
    cli: action.commandPayload || `#{cmt_ip_apim_cache_cli}\naz apim api policy update --resource-group "${action.resourceId.split("/")[4] || "rg"}" --service-name "${resourceName}" --api-id "all-apis"`,
    powershell: `#{cmt_ip_apim_cache_ps}\nSet-AzApiManagementPolicy -ResourceGroupName "${action.resourceId.split("/")[4] || "rg"}" -Name "${resourceName}" -PolicyFilePath "./apim-cache-policy.xml"`,
  };
}

export function buildServiceBusRemediationCommand(action: ServiceBusRemediationAction): {
  cli: string;
  powershell: string;
} {
  const resourceName = action.resourceName || action.resourceId.split("/").pop() || "sb-namespace";
  const rg = action.resourceId.split("/")[4] || "rg-servicebus";

  if (action.category === "RIGHTSIZE_MUS" || action.category === "PREMIUM_TO_STANDARD") {
    if (action.category === "RIGHTSIZE_MUS") {
      const capacity = action.recommendedCapacity || 1;
      return {
        cli:
          action.commandPayload ||
          `az servicebus namespace update --name "${resourceName}" --resource-group "${rg}" --capacity ${capacity}`,
        powershell: `#{cmt_ip_rightsizing_mu}\nSet-AzServiceBusNamespace -ResourceGroupName "${rg}" -Name "${resourceName}" -Capacity ${capacity}`,
      };
    }
    return {
      cli:
        action.commandPayload ||
        `az servicebus namespace update --name "${resourceName}" --resource-group "${rg}" --sku Standard`,
      powershell: `#{cmt_ip_mig_standard}\nSet-AzServiceBusNamespace -ResourceGroupName "${rg}" -Name "${resourceName}" -SkuName Standard`,
    };
  }

  if (action.category === "ORPHAN_PURGE") {
    return {
      cli:
        action.commandPayload ||
        `az servicebus queue delete --name "idle-queue" --namespace-name "${resourceName}" --resource-group "${rg}"`,
      powershell: `#{cmt_ip_del_queue}\nRemove-AzServiceBusQueue -ResourceGroupName "${rg}" -NamespaceName "${resourceName}" -Name "idle-queue"`,
    };
  }

  return {
    cli:
      action.commandPayload ||
      `az servicebus queue update --name "main-queue" --namespace-name "${resourceName}" --resource-group "${rg}" --default-message-time-to-live P7D`,
    powershell: `#{cmt_ip_retencion}\nSet-AzServiceBusQueue -ResourceGroupName "${rg}" -NamespaceName "${resourceName}" -Name "main-queue" -DefaultMessageTimeToLive (New-TimeSpan -Days 7)`,
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
      powershell: `#{cmt_ip_arb_basic}\nUpdate-AzEventGridDomain -ResourceGroupName "${rg}" -Name "${resourceName}" -Sku Basic`,
    };
  }

  return {
    cli:
      action.commandPayload ||
      `az eventgrid topic delete --name "${resourceName}" --resource-group "${rg}" --yes`,
    powershell: `#{cmt_ip_del_topic}\nRemove-AzEventGridTopic -ResourceGroupName "${rg}" -Name "${resourceName}"`,
  };
}

export function buildEventHubsRemediationCommand(action: EventHubsRemediationAction): {
  cli: string;
  powershell: string;
} {
  const resourceName = action.resourceName || action.resourceId.split("/").pop() || "eh-namespace";
  const rg = action.resourceId.split("/")[4] || "rg-eventhubs";

  if (EH_SKU_CATEGORIES.has(action.category)) {
    if (action.actionType === "REDUCE_UNITS" && action.recommendedCapacity) {
      const cap = action.recommendedCapacity;
      return {
        cli:
          action.commandPayload ||
          `az eventhubs namespace update --name "${resourceName}" --resource-group "${rg}" --capacity ${cap}`,
        powershell: `#{cmt_ip_rightsizing_putu}\nSet-AzEventHubNamespace -ResourceGroupName "${rg}" -Name "${resourceName}" -SkuCapacity ${cap}`,
      };
    }
    return {
      cli:
        action.commandPayload ||
        `az eventhubs namespace update --name "${resourceName}" --resource-group "${rg}" --sku Standard --capacity 2`,
      powershell: `#{cmt_ip_arb_standard}\nSet-AzEventHubNamespace -ResourceGroupName "${rg}" -Name "${resourceName}" -SkuName Standard -SkuCapacity 2`,
    };
  }

  if (action.category === "AUTO_INFLATE_OPTIMIZE") {
    return {
      cli:
        action.commandPayload ||
        `az eventhubs namespace update --name "${resourceName}" --resource-group "${rg}" --capacity 1 --enable-auto-inflate true --maximum-throughput-units 5`,
      powershell: `#{cmt_ip_autoinflate}\nSet-AzEventHubNamespace -ResourceGroupName "${rg}" -Name "${resourceName}" -SkuCapacity 1 -EnableAutoInflate $true -MaximumThroughputUnits 5`,
    };
  }

  return {
    cli:
      action.commandPayload ||
      `az eventhubs namespace delete --name "${resourceName}" --resource-group "${rg}" --yes`,
    powershell: `#{cmt_ip_del_namespace}\nRemove-AzEventHubNamespace -ResourceGroupName "${rg}" -Name "${resourceName}"`,
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
      powershell: `#{cmt_ip_rightsizing_ir}\nSet-AzDataFactoryV2IntegrationRuntime -ResourceGroupName "${rg}" -DataFactoryName "${resourceName}" -Name "AutoResolveIntegrationRuntime"`,
    };
  }

  if (action.category === "DATA_FLOW_CACHE_ENABLE") {
    return {
      cli:
        action.commandPayload ||
        `az datafactory integration-runtime managed update --factory-name "${resourceName}" --resource-group "${rg}" --name "Azure-AutoResolve-IR" --time-to-live 15`,
      powershell: `#{cmt_ip_quick_reuse}\nSet-AzDataFactoryV2IntegrationRuntime -ResourceGroupName "${rg}" -DataFactoryName "${resourceName}" -Name "Azure-AutoResolve-IR"`,
    };
  }

  return {
    cli:
      action.commandPayload ||
      `az datafactory delete --factory-name "${resourceName}" --resource-group "${rg}" --yes`,
    powershell: `#{cmt_ip_del_adf}\nRemove-AzDataFactoryV2 -ResourceGroupName "${rg}" -Name "${resourceName}"`,
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
      powershell: `#{cmt_ai_powershell_azure_cli_fijar_daily_cap}\nSet-AzApplicationInsights -ResourceGroupName "${rg}" -Name "${resourceName}" -DailyCap ${cap}`,
    };
  }

  if (action.category === "REDUCE_SAMPLING") {
    const sampling = action.recommendedSampling || 50;
    return {
      cli:
        action.commandPayload ||
        `az monitor app-insights component update --app "${resourceName}" --resource-group "${rg}" --sampling-percentage ${sampling}`,
      powershell: `#{cmt_ai_powershell_azure_cli_optimizar_tasa_de}\nSet-AzApplicationInsights -ResourceGroupName "${rg}" -Name "${resourceName}" -SamplingPercentage ${sampling}`,
    };
  }

  if (action.category === "PURGE_ORPHAN") {
    return {
      cli:
        action.commandPayload ||
        `az monitor app-insights component delete --app "${resourceName}" --resource-group "${rg}" --yes`,
      powershell: `#{cmt_ai_powershell_eliminar_componente_application_insights_huerfano}\nRemove-AzApplicationInsights -ResourceGroupName "${rg}" -Name "${resourceName}"`,
    };
  }

  return {
    cli:
      action.commandPayload ||
      `#{cmt_ai_configurar_minimumloglevel_warning_en_appsettings_json}`,
    powershell: `#{cmt_ai_configurar_minimumloglevel_warning_en_appsettings_json_2}`,
  };
}

export function buildLogAnalyticsRemediationCommand(action: LogAnalyticsRemediationAction): {
  cli: string;
  powershell: string;
} {
  const resourceName = action.resourceName || action.resourceId.split("/").pop() || "law-workspace";
  const rg = action.resourceId.split("/")[4] || "rg-monitoring";

  if (action.category === "COMMITMENT_TIER") {
    const tierLevel = action.recommendedTier?.replace(/\D/g, "") || "100";
    return {
      cli:
        action.commandPayload ||
        `az monitor log-analytics workspace update --resource-group "${rg}" --workspace-name "${resourceName}" --sku "CapacityReservation" --capacity-reservation-level ${tierLevel}`,
      powershell: `# PowerShell Azure CLI - Migrar a Commitment Tier\nSet-AzOperationalInsightsWorkspace -ResourceGroupName "${rg}" -Name "${resourceName}" -Sku "CapacityReservation" -CapacityReservationLevel ${tierLevel}`,
    };
  }

  if (action.category === "DAILY_CAP") {
    const cap = action.recommendedDailyCapGB || 5;
    return {
      cli:
        action.commandPayload ||
        `az monitor log-analytics workspace update --resource-group "${rg}" --workspace-name "${resourceName}" --daily-quota ${cap}`,
      powershell: `# PowerShell Azure CLI - Fijar Daily Cap de Ingesta\nSet-AzOperationalInsightsWorkspace -ResourceGroupName "${rg}" -Name "${resourceName}" -DailyQuotaGb ${cap}`,
    };
  }

  if (action.category === "RETENTION_ADJUST") {
    const retention = action.recommendedRetentionDays || 30;
    return {
      cli:
        action.commandPayload ||
        `az monitor log-analytics workspace update --resource-group "${rg}" --workspace-name "${resourceName}" --retention-time ${retention}`,
      powershell: `# PowerShell Azure CLI - Optimizar Retención de Datos\nSet-AzOperationalInsightsWorkspace -ResourceGroupName "${rg}" -Name "${resourceName}" -RetentionInDays ${retention}`,
    };
  }

  return {
    cli:
      action.commandPayload ||
      `az monitor log-analytics workspace delete --resource-group "${rg}" --workspace-name "${resourceName}" --yes`,
    powershell: `# PowerShell - Eliminar Log Analytics Workspace huérfano\nRemove-AzOperationalInsightsWorkspace -ResourceGroupName "${rg}" -Name "${resourceName}"`,
  };
}

export function buildAzureMonitorRemediationCommand(action: AzureMonitorRemediationAction): {
  cli: string;
  powershell: string;
} {
  const resourceName = action.resourceName || action.resourceId.split("/").pop() || "alert-rule";
  const rg = action.resourceId.split("/")[4] || "rg-monitoring";

  if (action.category === "KQL_OPTIMIZE") {
    return {
      cli:
        action.commandPayload ||
        `az monitor scheduled-query update --name "${resourceName}" --resource-group "${rg}" --query "${action.recommendedQuery || "traces | where TimeGenerated > ago(5m)"}"`,
      powershell: `# PowerShell Azure CLI - Optimizar Consulta KQL\nUpdate-AzScheduledQueryRule -ResourceGroupName "${rg}" -Name "${resourceName}"`,
    };
  }

  if (action.category === "MIGRATE_TO_METRIC") {
    return {
      cli:
        action.commandPayload ||
        `az monitor metrics alert create --name "${resourceName}-metric" --resource-group "${rg}" --scopes "${action.resourceId}" --condition "avg Percentage CPU > 85" --window-size 5m --evaluation-frequency 1m`,
      powershell: `# PowerShell Azure CLI - Migrar a Metric Alert\nAdd-AzMetricAlertRuleV2 -Name "${resourceName}-metric" -ResourceGroupName "${rg}"`,
    };
  }

  if (action.category === "FREQUENCY_ADJUST") {
    const freq = action.recommendedFrequency || "5m";
    return {
      cli:
        action.commandPayload ||
        `az monitor scheduled-query update --name "${resourceName}" --resource-group "${rg}" --evaluation-frequency ${freq}`,
      powershell: `# PowerShell Azure CLI - Ajustar Frecuencia de Evaluación\nUpdate-AzScheduledQueryRule -ResourceGroupName "${rg}" -Name "${resourceName}" -EvaluationFrequency (New-TimeSpan -Minutes 5)`,
    };
  }

  return {
    cli:
      action.commandPayload ||
      `az monitor scheduled-query delete --name "${resourceName}" --resource-group "${rg}" --yes`,
    powershell: `# PowerShell - Eliminar regla de alerta huérfana\nRemove-AzScheduledQueryRule -ResourceGroupName "${rg}" -Name "${resourceName}"`,
  };
}

export function buildSentinelRemediationCommand(action: SentinelRemediationAction): {
  cli: string;
  powershell: string;
} {
  const resourceName = action.resourceName || action.resourceId.split("/").pop() || "law-sentinel";
  const rg = action.resourceId.split("/")[4] || "rg-sentinel";

  if (action.category === "COMMITMENT_TIER") {
    const tierLevel = action.recommendedTier?.replace(/\D/g, "") || "100";
    return {
      cli:
        action.commandPayload ||
        `az monitor log-analytics workspace update --resource-group "${rg}" --workspace-name "${resourceName}" --sku "CapacityReservation" --capacity-reservation-level ${tierLevel}`,
      powershell: `# PowerShell Azure CLI - Migrar Sentinel a Capacity Reservation Tier\nSet-AzOperationalInsightsWorkspace -ResourceGroupName "${rg}" -Name "${resourceName}" -Sku "CapacityReservation" -CapacityReservationLevel ${tierLevel}`,
    };
  }

  if (action.category === "DAILY_CAP") {
    const cap = action.recommendedDailyCapGB || 5;
    return {
      cli:
        action.commandPayload ||
        `az monitor log-analytics workspace update --resource-group "${rg}" --workspace-name "${resourceName}" --daily-quota ${cap}`,
      powershell: `# PowerShell Azure CLI - Fijar Daily Cap en Sentinel\nSet-AzOperationalInsightsWorkspace -ResourceGroupName "${rg}" -Name "${resourceName}" -DailyQuotaGb ${cap}`,
    };
  }

  if (action.category === "RETENTION_ADJUST") {
    const retention = action.recommendedRetentionDays || 90;
    return {
      cli:
        action.commandPayload ||
        `az monitor log-analytics workspace update --resource-group "${rg}" --workspace-name "${resourceName}" --retention-time ${retention}`,
      powershell: `# PowerShell Azure CLI - Optimizar Retención y Habilitar Log Archive\nSet-AzOperationalInsightsWorkspace -ResourceGroupName "${rg}" -Name "${resourceName}" -RetentionInDays ${retention}`,
    };
  }

  return {
    cli:
      action.commandPayload ||
      `az sentinel alert-rule list --resource-group "${rg}" --workspace-name "${resourceName}"`,
    powershell: `# PowerShell Azure CLI - Listar y Auditar Reglas Inactivas de Sentinel\nGet-AzSentinelAlertRule -ResourceGroupName "${rg}" -WorkspaceName "${resourceName}"`,
  };
}

export function buildAlertRemediationCommand(action: AlertRemediationAction): {
  cli: string;
  powershell: string;
} {
  const ruleName = action.ruleName || action.ruleId.split("/").pop() || "alert-rule";
  const rg = action.ruleId.split("/")[4] || "rg-alerts";

  if (action.category === "PURGE_ORPHAN") {
    return {
      cli: action.commandPayload || `az monitor scheduled-query delete --name "${ruleName}" --resource-group "${rg}" --yes`,
      powershell: `#{cmt_al_powershell_azure_cli_eliminar_alerta_huerfana}\nRemove-AzScheduledQueryRule -ResourceGroupName "${rg}" -Name "${ruleName}"`,
    };
  }

  if (action.category === "ADJUST_FREQUENCY") {
    const freq = action.recommendedFrequency || "5m";
    return {
      cli: action.commandPayload || `az monitor scheduled-query update --name "${ruleName}" --resource-group "${rg}" --evaluation-frequency ${freq} --window-size 15m`,
      powershell: `#{cmt_al_powershell_azure_cli_ajustar_frecuencia_de}\nUpdate-AzScheduledQueryRule -ResourceGroupName "${rg}" -Name "${ruleName}" -EvaluationFrequency (New-TimeSpan -Minutes 5)`,
    };
  }

  if (action.category === "ASSIGN_ACTION_GROUP") {
    return {
      cli: action.commandPayload || `az monitor metrics alert update --name "${ruleName}" --resource-group "${rg}" --add-action-group "ag-default"`,
      powershell: `#{cmt_al_powershell_azure_cli_vincular_action_group}\nAdd-AzMetricAlertRuleV2 -ResourceGroupName "${rg}" -Name "${ruleName}"`,
    };
  }

  return {
    cli: action.commandPayload || `az monitor alert show --name "${ruleName}" --resource-group "${rg}"`,
    powershell: `#{cmt_al_powershell_azure_cli}\nGet-AzScheduledQueryRule -ResourceGroupName "${rg}" -Name "${ruleName}"`,
  };
}

export function buildActionGroupRemediationCommand(action: ActionGroupRemediationAction): {
  cli: string;
  powershell: string;
} {
  const resourceName = action.resourceName || action.resourceId.split("/").pop() || "action-group";
  const rg = action.resourceId.split("/")[4] || "rg-alerts";

  if (action.category === "ORPHAN_PURGE") {
    return {
      cli: action.commandPayload || `az monitor action-group delete --name "${resourceName}" --resource-group "${rg}"`,
      powershell: `#{cmt_ag_powershell_azure_cli_eliminar_action_group}\nRemove-AzActionGroup -ResourceGroupName "${rg}" -Name "${resourceName}"`,
    };
  }

  if (action.category === "ADD_RECEIVERS" || action.category === "FIX_BOUNCED_EMAILS") {
    return {
      cli: action.commandPayload || `az monitor action-group update --name "${resourceName}" --resource-group "${rg}" --add-action email "OpsLead" "ops-team@company.com"`,
      powershell: `#{cmt_ag_powershell_azure_cli_agregar_destinatario_de}\nSet-AzActionGroup -ResourceGroupName "${rg}" -Name "${resourceName}"`,
    };
  }

  if (action.category === "ENDPOINT_DEBUG") {
    return {
      cli: action.commandPayload || `az monitor action-group test-notifications --action-group "${resourceName}" --resource-group "${rg}" --alert-type "microsoft.insights/metricalerts"`,
      powershell: `#{cmt_ag_powershell_azure_cli_test_de_notificaciones}\nTest-AzActionGroup -ResourceGroupName "${rg}" -ActionGroupName "${resourceName}"`,
    };
  }

  return {
    cli: action.commandPayload || `az monitor action-group show --name "${resourceName}" --resource-group "${rg}"`,
    powershell: `#{cmt_ag_powershell_azure_cli}\nGet-AzActionGroup -ResourceGroupName "${rg}" -Name "${resourceName}"`,
  };
}

/**
 * Escapa un valor para interpolarlo dentro de comillas dobles en un comando de
 * shell. Los nombres de recurso de Azure los elige el cliente, y el comando
 * resultante termina en la terminal del operador via copiar-pegar: sin esto,
 * un recurso llamado `x"; rm -rf ~; #` produce un comando destructivo.
 * (Riesgo residual registrado en docs/security/audit-2026-08-21.md.)
 */
export function shellQuote(value: unknown): string {
  const raw = typeof value === "string" ? value : String(value ?? "");
  return raw.replace(/[\\"$`]/g, (c) => "\\" + c).replace(/[\r\n]/g, " ");
}

export function buildWorkbookRemediationCommand(action: WorkbookRemediationAction): {
  cli: string;
  powershell: string;
} {
  const parts = action.resourceId.split("/");
  const name = shellQuote(parts.pop() || "workbook");
  const rg = shellQuote(parts[4] || "rg-observability");

  if (action.category === "PURGE_ORPHAN") {
    return {
      cli:
        action.commandPayload ||
        `#{cmt_wb_verificar_antes_de_borrar_el_workbook}\naz monitor app-insights workbook show --name "${name}" --resource-group "${rg}"\naz monitor app-insights workbook delete --name "${name}" --resource-group "${rg}" --yes`,
      powershell: `#{cmt_wb_eliminar_workbook_huerfano}\nGet-AzApplicationInsightsWorkbook -ResourceGroupName "${rg}" -Name "${name}"\nRemove-AzApplicationInsightsWorkbook -ResourceGroupName "${rg}" -Name "${name}"`,
    };
  }

  if (action.category === "DISABLE_AUTOREFRESH") {
    return {
      cli:
        action.commandPayload ||
        `#{cmt_wb_el_intervalo_de_auto_refresh_vive}\n#{cmt_wb_exportar_la_definicion_ajustar_autorefreshseconds_y}\naz monitor app-insights workbook show --name "${name}" --resource-group "${rg}" --query "serializedData" -o tsv > workbook.json\n#{cmt_wb_editar_workbook_json_autorefreshseconds_900_15}\naz monitor app-insights workbook update --name "${name}" --resource-group "${rg}" --serialized-data @workbook.json`,
      powershell: `#{cmt_wb_ajustar_auto_refresh_a_15_min}\n$wb = Get-AzApplicationInsightsWorkbook -ResourceGroupName "${rg}" -Name "${name}"\n$def = $wb.SerializedData | ConvertFrom-Json\n$def.autoRefreshSeconds = 900\nUpdate-AzApplicationInsightsWorkbook -ResourceGroupName "${rg}" -Name "${name}" -SerializedData ($def | ConvertTo-Json -Depth 40)`,
    };
  }

  if (action.category === "OPTIMIZE_KQL") {
    return {
      cli:
        action.commandPayload ||
        `#{cmt_wb_patron_a_aplicar_en_cada_consulta}\n#{cmt_wb_antes_de_agregar_para_que_el}\n#\n#{cmt_wb_antes_containerlogv2_summarize_count_by_containername}\n#{cmt_wb_despues_containerlogv2}\n#{cmt_wb_where_timegenerated_ago_24h}\n#{cmt_wb_summarize_count_by_containername}\n#\naz monitor app-insights workbook show --name "${name}" --resource-group "${rg}" --query "serializedData" -o tsv`,
      powershell: `#{cmt_wb_exportar_la_definicion_para_revisar_las}\n(Get-AzApplicationInsightsWorkbook -ResourceGroupName "${rg}" -Name "${name}").SerializedData | Out-File workbook.json`,
    };
  }

  if (action.category === "PROMOTE_TO_SHARED") {
    return {
      cli:
        action.commandPayload ||
        `#{cmt_wb_publicar_como_workbook_compartido_para_consolidar}\naz monitor app-insights workbook create --name "${name}" --resource-group "${rg}" --category workbook --shared-type-kind shared --serialized-data @workbook.json`,
      powershell: `#{cmt_wb_crear_la_version_compartida_a_partir}\nNew-AzApplicationInsightsWorkbook -ResourceGroupName "${rg}" -Name "${name}" -Category workbook -Kind shared -SerializedData (Get-Content workbook.json -Raw)`,
    };
  }

  return {
    cli: action.commandPayload || `az monitor app-insights workbook show --name "${name}" --resource-group "${rg}"`,
    powershell: `Get-AzApplicationInsightsWorkbook -ResourceGroupName "${rg}" -Name "${name}"`,
  };
}

export function buildNetworkWatcherRemediationCommand(action: NetworkWatcherRemediationAction): {
  cli: string;
  powershell: string;
} {
  const parts = action.resourceId.split("/");
  const watcher = shellQuote(parts.pop() || "NetworkWatcher_eastus");
  const rg = shellQuote(parts[4] || "NetworkWatcherRG");

  if (action.category === "TRAFFIC_ANALYTICS_INTERVAL") {
    return {
      cli:
        action.commandPayload ||
        `#{cmt_nw_traffic_analytics_de_10_60_min}\naz network watcher flow-log update \\\n  --name <flow-log-name> \\\n  --resource-group "${rg}" \\\n  --traffic-analytics true \\\n  --interval 60`,
      powershell: `#{cmt_nw_traffic_analytics_a_60_min}\n$fl = Get-AzNetworkWatcherFlowLog -NetworkWatcherName "${watcher}" -ResourceGroupName "${rg}" -Name <flow-log-name>\nSet-AzNetworkWatcherFlowLog -NetworkWatcherName "${watcher}" -ResourceGroupName "${rg}" -Name $fl.Name \\\n  -EnableTrafficAnalytics -TrafficAnalyticsInterval 60 \\\n  -TrafficAnalyticsWorkspaceId $fl.FlowAnalyticsConfiguration.NetworkWatcherFlowAnalyticsConfiguration.WorkspaceResourceId`,
    };
  }

  if (action.category === "STORAGE_LIFECYCLE") {
    return {
      cli:
        action.commandPayload ||
        `#{cmt_nw_dos_frentes_acotar_la_retencion_del}\n#{cmt_nw_en_el_contenedor_porque_el_flow}\naz network watcher flow-log update --name <flow-log-name> --resource-group "${rg}" --retention 30\n\naz storage account management-policy create \\\n  --account-name <storage-account> \\\n  --resource-group "${rg}" \\\n  --policy '{"rules":[{"enabled":true,"name":"purge-flowlogs-30d","type":"Lifecycle","definition":{"filters":{"blobTypes":["blockBlob"],"prefixMatch":["insights-logs-networksecuritygroupflowevent"]},"actions":{"baseBlob":{"delete":{"daysAfterModificationGreaterThan":30}}}}}]}'`,
      powershell: `#{cmt_nw_retencion_de_30_dias_en_el}\nSet-AzNetworkWatcherFlowLog -NetworkWatcherName "${watcher}" -ResourceGroupName "${rg}" -Name <flow-log-name> -EnableRetention -RetentionPolicyDays 30\n\n#{cmt_nw_regla_de_ciclo_de_vida_en}\n$action = Add-AzStorageAccountManagementPolicyAction -BaseBlobAction Delete -daysAfterModificationGreaterThan 30\n$filter = New-AzStorageAccountManagementPolicyFilter -PrefixMatch "insights-logs-networksecuritygroupflowevent" -BlobType blockBlob\n$rule = New-AzStorageAccountManagementPolicyRule -Name "purge-flowlogs-30d" -Action $action -Filter $filter\nSet-AzStorageAccountManagementPolicy -ResourceGroupName "${rg}" -StorageAccountName <storage-account> -Rule $rule`,
    };
  }

  if (action.category === "MONITOR_FREQUENCY") {
    return {
      cli:
        action.commandPayload ||
        `#{cmt_nw_sondeo_cada_300_s_en_vez}\n#{cmt_nw_prueba_mes_no_por_sondeo_el}\n#{cmt_nw_de_ingerirse_no_en_la_tarifa}\naz network watcher connection-monitor test-configuration add \\\n  --connection-monitor <monitor-name> \\\n  --location <region> \\\n  --name <test-config-name> \\\n  --frequency 300 \\\n  --protocol Tcp \\\n  --tcp-port 443`,
      powershell: `#{cmt_nw_ajustar_la_frecuencia_del_test_de}\n$tc = New-AzNetworkWatcherConnectionMonitorTestConfigurationObject -Name <test-config-name> -TestFrequencySec 300 -ProtocolConfiguration (New-AzNetworkWatcherConnectionMonitorProtocolConfigurationObject -TcpProtocol -Port 443)\nSet-AzNetworkWatcherConnectionMonitor -NetworkWatcherName "${watcher}" -ResourceGroupName "${rg}" -Name <monitor-name> -TestConfiguration $tc`,
    };
  }

  if (action.category === "ORPHAN_PURGE") {
    return {
      cli:
        action.commandPayload ||
        `#{cmt_nw_confirmar_que_el_endpoint_realmente_ya}\naz network watcher connection-monitor show --name <monitor-name> --location <region>\naz network watcher connection-monitor delete --name <monitor-name> --location <region>`,
      powershell: `#{cmt_nw_eliminar_el_connection_monitor_huerfano}\nGet-AzNetworkWatcherConnectionMonitor -NetworkWatcherName "${watcher}" -ResourceGroupName "${rg}" -Name <monitor-name>\nRemove-AzNetworkWatcherConnectionMonitor -NetworkWatcherName "${watcher}" -ResourceGroupName "${rg}" -Name <monitor-name>`,
    };
  }

  return {
    cli: action.commandPayload || `az network watcher show --name "${watcher}" --resource-group "${rg}"`,
    powershell: `Get-AzNetworkWatcher -Name "${watcher}" -ResourceGroupName "${rg}"`,
  };
}

export function buildDefenderRemediationCommand(action: DefenderRemediationAction): {
  cli: string;
  powershell: string;
} {
  const sub = shellQuote(action.subscriptionId);
  const plan = shellQuote(action.planKey);

  if (action.category === "DOWNGRADE_SERVERS_TIER") {
    return {
      cli:
        action.commandPayload ||
        `#{cmt_df_el_tier_de_defender_for_servers}\n#{cmt_df_verificar_primero_el_estado_actual}\naz security pricing show --name "${plan}" --subscription "${sub}"\n\n#{cmt_df_opcion_a_toda_la_suscripcion_a}\naz security pricing create --name "${plan}" --tier Standard --subplan P1 --subscription "${sub}"\n\n#{cmt_df_opcion_b_conservar_plan_2_y}\n#{cmt_df_de_exclusion_de_defender_for_servers}\naz resource tag --ids <resource-id> --tags "excludeFromDefenderForServers=true" --is-incremental`,
      powershell: `#{cmt_df_estado_actual_del_plan}\nGet-AzSecurityPricing -Name "${plan}"\n\n#{cmt_df_toda_la_suscripcion_a_plan_1}\nSet-AzContext -Subscription "${sub}"\nSet-AzSecurityPricing -Name "${plan}" -PricingTier Standard -SubPlan P1\n\n#{cmt_df_o_excluir_una_vm_puntual_conservando}\nUpdate-AzTag -ResourceId <resource-id> -Tag @{ excludeFromDefenderForServers = "true" } -Operation Merge`,
    };
  }

  if (action.category === "EXCLUDE_STORAGE_BACKUP") {
    return {
      cli:
        action.commandPayload ||
        `#{cmt_df_confirmar_que_la_cuenta_no_recibe}\n#{cmt_df_defender_for_storage_se_puede_desactivar}\naz security atp storage show --resource-group <rg> --storage-account <storage-account>\naz security atp storage update --resource-group <rg> --storage-account <storage-account> --is-enabled false`,
      powershell: `#{cmt_df_estado_por_cuenta}\nGet-AzSecurityAdvancedThreatProtection -ResourceId <storage-account-resource-id>\n\n#{cmt_df_desactivar_en_esa_cuenta_puntual}\nDisable-AzSecurityAdvancedThreatProtection -ResourceId <storage-account-resource-id>`,
    };
  }

  if (action.category === "ENABLE_DB_PROTECTION") {
    return {
      cli:
        action.commandPayload ||
        `#{cmt_df_hallazgo_de_riesgo_no_de_ahorro}\naz security pricing create --name "${plan}" --tier Standard --subscription "${sub}"\naz security pricing show --name "${plan}" --subscription "${sub}"`,
      powershell: `#{cmt_df_activar_proteccion_avanzada_en_bases_de}\nSet-AzContext -Subscription "${sub}"\nSet-AzSecurityPricing -Name "${plan}" -PricingTier Standard\nGet-AzSecurityPricing -Name "${plan}"`,
    };
  }

  if (action.category === "GOVERN_AUTO_PROVISIONING") {
    return {
      cli:
        action.commandPayload ||
        `#{cmt_df_revisar_todos_los_planes_de_la}\naz security pricing list --subscription "${sub}" --query "value[].{plan:name,tier:properties.pricingTier,subPlan:properties.subPlan}" -o table\n\n#{cmt_df_desactivar_el_plan_sin_recursos_que}\naz security pricing create --name "${plan}" --tier Free --subscription "${sub}"`,
      powershell: `#{cmt_df_inventario_de_planes_de_la_suscripcion}\nSet-AzContext -Subscription "${sub}"\nGet-AzSecurityPricing | Select-Object Name, PricingTier, SubPlan | Format-Table\n\n#{cmt_df_desactivar_el_plan_sin_cobertura_efectiva}\nSet-AzSecurityPricing -Name "${plan}" -PricingTier Free`,
    };
  }

  return {
    cli: action.commandPayload || `az security pricing show --name "${plan}" --subscription "${sub}"`,
    powershell: `Get-AzSecurityPricing -Name "${plan}"`,
  };
}

export function buildKeyVaultRemediationCommand(action: KeyVaultRemediationAction): {
  cli: string;
  powershell: string;
} {
  const parts = action.vaultId.split("/");
  const vault = shellQuote(action.vaultName || parts[parts.length - 1] || "kv");
  const rg = shellQuote(parts[4] || "rg");

  if (action.category === "DOWNGRADE_MANAGED_HSM") {
    return {
      cli:
        action.commandPayload ||
        `# Un pool de Managed HSM no se puede "bajar" de SKU: hay que exportar las\n#{cmt_kv_claves_a_un_key_vault_premium}\n#{cmt_kv_1_respaldo_de_seguridad_completo_del}\naz keyvault security-domain download --hsm-name "${vault}" --sd-wrapping-keys cert1.cer cert2.cer cert3.cer --sd-quorum 2 --security-domain-file "${vault}-SD.json"\n\n#{cmt_kv_2_backup_de_cada_clave_y}\naz keyvault key backup --hsm-name "${vault}" --name <key-name> --file key.backup\naz keyvault key restore --vault-name <kv-premium-destino> --file key.backup\n\n#{cmt_kv_3_recien_con_las_claves_verificadas}\naz keyvault delete --hsm-name "${vault}" --resource-group "${rg}"\naz keyvault purge --hsm-name "${vault}" --location <region>   # irreversible`,
      powershell: `#{cmt_kv_exportar_y_dar_de_baja_el}\n#{cmt_kv_1_security_domain_imprescindible_sin_el}\nExport-AzKeyVaultSecurityDomain -Name "${vault}" -Certificates cert1.cer,cert2.cer,cert3.cer -OutputPath "${vault}-SD.json" -Quorum 2\n\n#{cmt_kv_2_backup_restore_de_cada_clave}\nBackup-AzKeyVaultKey -HsmName "${vault}" -Name <key-name> -OutputFile key.backup\nRestore-AzKeyVaultKey -VaultName <kv-premium-destino> -InputFile key.backup\n\n#{cmt_kv_3_baja_del_pool_una_vez}\nRemove-AzKeyVaultManagedHsm -Name "${vault}" -ResourceGroupName "${rg}"`,
    };
  }

  if (action.category === "POLLING_CACHE_OPTIMIZATION") {
    return {
      cli:
        action.commandPayload ||
        `#{cmt_kv_el_arreglo_es_de_codigo_no}\n#{cmt_kv_memoria_con_ttl_en_vez_de}\n#\n#{cmt_kv_net_registrar_el_cliente_una_sola}\n#{cmt_kv_builder_services_addazureclients_b_b_addsecretclient}\n#   var cached = await cache.GetOrCreateAsync("db-conn", e => {\n#{cmt_kv_e_absoluteexpirationrelativetonow_timespan_fromminutes_30}\n#       return client.GetSecretAsync("db-conn");\n#   });\n#\n#{cmt_kv_alternativa_sin_tocar_codigo_en_app}\n#{cmt_kv_microsoft_keyvault_en_app_settings_que}\naz webapp config appsettings set --name <app> --resource-group "${rg}" \\\n  --settings "DbConn=@Microsoft.KeyVault(SecretUri=https://${vault}.vault.azure.net/secrets/db-conn/)"\n\n#{cmt_kv_verificar_el_volumen_y_los_429}\naz monitor metrics list --resource <vault-resource-id> --metric ServiceApiHit --interval PT1H`,
      powershell: `#{cmt_kv_referencia_de_key_vault_en_app}\nSet-AzWebApp -Name <app> -ResourceGroupName "${rg}" -AppSettings @{ DbConn = "@Microsoft.KeyVault(SecretUri=https://${vault}.vault.azure.net/secrets/db-conn/)" }\n\n#{cmt_kv_medir_el_efecto_sobre_las_transacciones}\nGet-AzMetric -ResourceId <vault-resource-id> -MetricName ServiceApiHit -TimeGrain 01:00:00`,
    };
  }

  if (action.category === "PURGE_EXPIRED_OBJECTS") {
    return {
      cli:
        action.commandPayload ||
        `#{cmt_kv_auditar_antes_de_purgar_un_certificado}\naz keyvault certificate list --vault-name "${vault}" --query "[?attributes.expires<'$(date -u +%Y-%m-%d)'].{name:name,expires:attributes.expires}" -o table\naz keyvault secret list --vault-name "${vault}" --query "[?attributes.expires!=null].{name:name,expires:attributes.expires}" -o table\n\n#{cmt_kv_deshabilitar_primero_reversible_en_vez_de}\naz keyvault certificate set-attributes --vault-name "${vault}" --name <cert> --enabled false\n\n#{cmt_kv_si_la_boveda_entera_esta_sin}\naz keyvault show --name "${vault}" --query "properties.enablePurgeProtection"`,
      powershell: `#{cmt_kv_inventario_de_objetos_vencidos}\nGet-AzKeyVaultCertificate -VaultName "${vault}" | Where-Object { $_.Expires -lt (Get-Date) } | Select-Object Name, Expires\nGet-AzKeyVaultSecret -VaultName "${vault}" | Where-Object { $_.Expires -lt (Get-Date) } | Select-Object Name, Expires\n\n#{cmt_kv_deshabilitar_en_vez_de_borrar_reversible}\nUpdate-AzKeyVaultCertificate -VaultName "${vault}" -Name <cert> -Enable $false\n\n#{cmt_kv_estado_de_purge_protection_de_la}\n(Get-AzKeyVault -VaultName "${vault}").EnablePurgeProtection`,
    };
  }

  if (action.category === "ENABLE_RBAC") {
    return {
      cli:
        action.commandPayload ||
        `#{cmt_kv_orden_importante_activar_rbac_invalida_las}\n#{cmt_kv_primero_inventariar_quien_tiene_acceso_hoy}\naz keyvault show --name "${vault}" --query "properties.accessPolicies[].{objectId:objectId,secrets:permissions.secrets,keys:permissions.keys,certs:permissions.certificates}" -o json\n\n#{cmt_kv_segundo_asignar_el_rol_equivalente_a}\naz role assignment create --role "Key Vault Secrets User" --assignee <objectId> --scope <vault-resource-id>\naz role assignment create --role "Key Vault Crypto User"  --assignee <objectId> --scope <vault-resource-id>\n\n#{cmt_kv_recien_entonces_activar_rbac}\naz keyvault update --name "${vault}" --resource-group "${rg}" --enable-rbac-authorization true`,
      powershell: `#{cmt_kv_1_inventario_de_access_policies_actuales}\n(Get-AzKeyVault -VaultName "${vault}").AccessPolicies | Select-Object ObjectId, PermissionsToSecrets, PermissionsToKeys, PermissionsToCertificates\n\n#{cmt_kv_2_rol_equivalente_por_principal}\nNew-AzRoleAssignment -ObjectId <objectId> -RoleDefinitionName "Key Vault Secrets User" -Scope <vault-resource-id>\n\n#{cmt_kv_3_activar_rbac_solo_con_los}\nUpdate-AzKeyVault -VaultName "${vault}" -ResourceGroupName "${rg}" -EnableRbacAuthorization $true`,
    };
  }

  return {
    cli: action.commandPayload || `az keyvault show --name "${vault}" --resource-group "${rg}"`,
    powershell: `Get-AzKeyVault -VaultName "${vault}" -ResourceGroupName "${rg}"`,
  };
}

export function buildEntraIdRemediationCommand(action: EntraIdRemediationAction): {
  cli: string;
  powershell: string;
} {
  const target = shellQuote(action.targetId);
  const upnList = (action.affectedPrincipals || []).slice(0, 5);
  const upnBlock = upnList.length > 0 ? upnList.map((u) => `#   ${shellQuote(u)}`).join("\n") : "#   (ninguno)";

  if (action.category === "RECLAIM_USER_LICENSE") {
    return {
      cli:
        action.commandPayload ||
        `#{cmt_eid_azure_cli_no_gestiona_asignacion_de}\n# Principales afectados (primeros ${upnList.length}):\n${upnBlock}\n#\n#{cmt_eid_1_confirmar_el_skuid_real_del}\naz rest --method GET --url "https://graph.microsoft.com/v1.0/subscribedSkus" \\\n  --query "value[?skuPartNumber=='${target}'].{sku:skuPartNumber,id:skuId,prepaid:prepaidUnits.enabled,consumed:consumedUnits}"\n\n#{cmt_eid_2_quitar_la_licencia_a_un}\naz rest --method POST \\\n  --url "https://graph.microsoft.com/v1.0/users/<upn>/assignLicense" \\\n  --headers "Content-Type=application/json" \\\n  --body '{"addLicenses":[],"removeLicenses":["<skuId>"]}'`,
      powershell: `#{cmt_eid_microsoft_graph_powershell_sdk}\nConnect-MgGraph -Scopes "User.ReadWrite.All","Organization.Read.All"\n\n$sku = Get-MgSubscribedSku | Where-Object SkuPartNumber -eq "${target}"\n\n#{cmt_eid_revisar_primero_a_quien_se_le}\n$upns = @(\n${upnList.map((u) => `  "${shellQuote(u)}"`).join(",\n") || '  # (ninguno)'}\n)\n$upns | ForEach-Object { Get-MgUser -UserId $_ -Property DisplayName,AccountEnabled,SignInActivity | Select-Object DisplayName, AccountEnabled }\n\n#{cmt_eid_recien_entonces_desasignar}\n$upns | ForEach-Object { Set-MgUserLicense -UserId $_ -AddLicenses @() -RemoveLicenses @($sku.SkuId) }`,
    };
  }

  if (action.category === "DOWNGRADE_DOMAIN_SERVICES") {
    const parts = action.targetId.split("/");
    const name = shellQuote(parts.pop() || "aadds");
    const rg = shellQuote(parts[4] || "rg");
    return {
      cli:
        action.commandPayload ||
        `#{cmt_eid_ojo_bajar_de_premium_a_standard}\n#{cmt_eid_caliente_azure_exige_recrear_el_dominio}\n#{cmt_eid_standard_si_es_un_cambio_en}\naz ad ds show --name "${name}" --resource-group "${rg}" --query "{sku:sku,domainName:domainName}"\naz ad ds update --name "${name}" --resource-group "${rg}" --sku Standard`,
      powershell: `#{cmt_eid_estado_actual_del_dominio_administrado}\nGet-AzADDomainService -Name "${name}" -ResourceGroupName "${rg}" | Select-Object Name, Sku, DomainName\n\n#{cmt_eid_cambio_de_sku_enterprise_standard_es}\nUpdate-AzADDomainService -Name "${name}" -ResourceGroupName "${rg}" -Sku Standard`,
    };
  }

  if (action.category === "PURGE_WORKLOAD_LICENSE") {
    return {
      cli:
        action.commandPayload ||
        `# Service principals sin autenticaciones recientes (primeros ${upnList.length}):\n${upnBlock}\n#\n#{cmt_eid_confirmar_la_ultima_actividad_antes_de}\n#{cmt_eid_ser_una_integracion_estacional_o_de}\naz rest --method GET \\\n  --url "https://graph.microsoft.com/beta/servicePrincipalSignInActivities?\$filter=appId eq '<appId>'"\n\n#{cmt_eid_la_licencia_workload_id_se_gestiona}\n# Identity > Workload identities > Premium assignments`,
      powershell: `Connect-MgGraph -Scopes "Application.Read.All","AuditLog.Read.All"\n\n#{cmt_eid_ultima_actividad_de_cada_service_principal}\n@(\n${upnList.map((u) => `  "${shellQuote(u)}"`).join(",\n") || '  # (ninguno)'}\n) | ForEach-Object { Get-MgBetaServicePrincipalSignInActivity -Filter "appId eq '$_'" }`,
    };
  }

  if (action.category === "MFA_FRAUD_PREVENTION") {
    return {
      cli:
        action.commandPayload ||
        `#{cmt_eid_el_fraude_de_bombeo_telefonico_se}\n#{cmt_eid_1_revisar_los_metodos_de_autenticacion}\naz rest --method GET --url "https://graph.microsoft.com/v1.0/policies/authenticationMethodsPolicy"\n\n#{cmt_eid_2_priorizar_authenticator_fido2_sobre_sms}\n#{cmt_eid_fraude_telefonico_en_entra_protection_authentication}\n#    SMS > Telecom fraud protection.`,
      powershell: `Connect-MgGraph -Scopes "Policy.Read.All"\n\n#{cmt_eid_metodos_de_autenticacion_habilitados}\nGet-MgPolicyAuthenticationMethodPolicy | Select-Object -ExpandProperty AuthenticationMethodConfigurations | Select-Object Id, State`,
    };
  }

  return {
    cli: action.commandPayload || `az rest --method GET --url "https://graph.microsoft.com/v1.0/subscribedSkus"`,
    powershell: `Get-MgSubscribedSku | Select-Object SkuPartNumber, ConsumedUnits`,
  };
}

export function buildWafRemediationCommand(action: WafRemediationAction): {
  cli: string;
  powershell: string;
} {
  const parts = action.policyId.split("/");
  const policy = shellQuote(action.policyName || parts[parts.length - 1] || "wafPolicy");
  const rg = shellQuote(parts[4] || "rg");
  const isFrontDoor = action.policyId.toLowerCase().includes("frontdoor");

  if (action.category === "ENABLE_PREVENTION") {
    return {
      cli:
        action.commandPayload ||
        `#{cmt_waf_no_cambiar_en_frio_revisar_primero}\n#{cmt_waf_porque_las_que_hoy_solo_registran}\n#\n#{cmt_waf_1_top_de_reglas_disparadas_en}\n#{cmt_waf_azurediagnostics}\n#    | where Category in ('ApplicationGatewayFirewallLog','FrontDoorWebApplicationFirewallLog')\n#{cmt_waf_where_timegenerated_ago_30d}\n#{cmt_waf_summarize_count_by_ruleid_s_action}\n#{cmt_waf_order_by_count_desc}\n#\n#{cmt_waf_2_crear_exclusiones_para_los_falsos}\n#{cmt_waf_3_recien_entonces_pasar_a_prevention}\n${
          isFrontDoor
            ? `az network front-door waf-policy update --name "${policy}" --resource-group "${rg}" --mode Prevention`
            : `az network application-gateway waf-policy policy-setting update --policy-name "${policy}" --resource-group "${rg}" --mode Prevention`
        }`,
      powershell: isFrontDoor
        ? `#{cmt_waf_revisar_los_eventos_de_detection_antes}\n$p = Get-AzFrontDoorWafPolicy -Name "${policy}" -ResourceGroupName "${rg}"\n$p.PolicySetting\n\nUpdate-AzFrontDoorWafPolicy -Name "${policy}" -ResourceGroupName "${rg}" -Mode Prevention`
        : `$p = Get-AzApplicationGatewayFirewallPolicy -Name "${policy}" -ResourceGroupName "${rg}"\n$p.PolicySettings\n\n$p.PolicySettings.Mode = "Prevention"\nSet-AzApplicationGatewayFirewallPolicy -InputObject $p`,
    };
  }

  if (action.category === "GEO_FILTER_RULE") {
    return {
      cli:
        action.commandPayload ||
        `#{cmt_waf_la_prioridad_es_lo_que_produce}\n#{cmt_waf_regla_se_evalue_antes_que_la}\n#{cmt_waf_pagar_la_inspeccion_completa}\n#{cmt_waf_confirmar_antes_que_no_haya_usuarios}\n${
          isFrontDoor
            ? `az network front-door waf-policy rule create \\\n  --policy-name "${policy}" --resource-group "${rg}" \\\n  --name blockHighRiskGeos --priority 10 --rule-type MatchRule --action Block --defer\naz network front-door waf-policy rule match-condition add \\\n  --policy-name "${policy}" --resource-group "${rg}" --name blockHighRiskGeos \\\n  --match-variable RemoteAddr --operator GeoMatch --values CN RU VN`
            : `az network application-gateway waf-policy custom-rule create \\\n  --policy-name "${policy}" --resource-group "${rg}" \\\n  --name blockHighRiskGeos --priority 10 --rule-type MatchRule --action Block\naz network application-gateway waf-policy custom-rule match-condition add \\\n  --policy-name "${policy}" --resource-group "${rg}" --name blockHighRiskGeos \\\n  --match-variables RemoteAddr --operator GeoMatch --values CN RU VN`
        }`,
      powershell: isFrontDoor
        ? `$cond = New-AzFrontDoorWafMatchConditionObject -MatchVariable RemoteAddr -OperatorProperty GeoMatch -MatchValue "CN","RU","VN"\n$rule = New-AzFrontDoorWafCustomRuleObject -Name "blockHighRiskGeos" -RuleType MatchRule -MatchCondition $cond -Action Block -Priority 10\nUpdate-AzFrontDoorWafPolicy -Name "${policy}" -ResourceGroupName "${rg}" -CustomRule $rule`
        : `$cond = New-AzApplicationGatewayFirewallCondition -MatchVariable (New-AzApplicationGatewayFirewallMatchVariable -VariableName RemoteAddr) -Operator GeoMatch -MatchValue "CN","RU","VN"\n$rule = New-AzApplicationGatewayFirewallCustomRule -Name "blockHighRiskGeos" -Priority 10 -RuleType MatchRule -MatchCondition $cond -Action Block\n$p = Get-AzApplicationGatewayFirewallPolicy -Name "${policy}" -ResourceGroupName "${rg}"\n$p.CustomRules.Add($rule)\nSet-AzApplicationGatewayFirewallPolicy -InputObject $p`,
    };
  }

  if (action.category === "RATE_LIMITING") {
    return {
      cli:
        action.commandPayload ||
        `#{cmt_waf_empezar_en_modo_log_para_calibrar}\n#{cmt_waf_mal_elegido_bloquea_a_todos_los}\n${
          isFrontDoor
            ? `az network front-door waf-policy rule create \\\n  --policy-name "${policy}" --resource-group "${rg}" \\\n  --name throttleByIp --priority 20 --rule-type RateLimitRule \\\n  --rate-limit-duration 1 --rate-limit-threshold 1000 --action Log --defer`
            : `az network application-gateway waf-policy custom-rule create \\\n  --policy-name "${policy}" --resource-group "${rg}" \\\n  --name throttleByIp --priority 20 --rule-type RateLimitRule \\\n  --rate-limit-duration OneMin --rate-limit-threshold 1000 --group-by-user-session ClientAddr --action Log`
        }\n\n# Tras validar el umbral, cambiar --action a Block.`,
      powershell: `#{cmt_waf_regla_de_rate_limit_en_modo}\n$cond = New-AzFrontDoorWafMatchConditionObject -MatchVariable RequestUri -OperatorProperty Any\n$rule = New-AzFrontDoorWafCustomRuleObject -Name "throttleByIp" -RuleType RateLimitRule -RateLimitDurationInMinutes 1 -RateLimitThreshold 1000 -MatchCondition $cond -Action Log -Priority 20\nUpdate-AzFrontDoorWafPolicy -Name "${policy}" -ResourceGroupName "${rg}" -CustomRule $rule`,
    };
  }

  if (action.category === "PURGE_ORPHAN_POLICY") {
    return {
      cli:
        action.commandPayload ||
        `#{cmt_waf_verificar_que_realmente_no_tenga_asociaciones}\n#{cmt_waf_personalizadas_se_pierden_con_la_politica}\n${
          isFrontDoor
            ? `az network front-door waf-policy show --name "${policy}" --resource-group "${rg}" --query "{frontendEndpoints:frontendEndpointLinks,securityPolicies:securityPolicyLinks}"\naz network front-door waf-policy delete --name "${policy}" --resource-group "${rg}"`
            : `az network application-gateway waf-policy show --name "${policy}" --resource-group "${rg}" --query "{gateways:applicationGateways,listeners:httpListeners}"\naz network application-gateway waf-policy delete --name "${policy}" --resource-group "${rg}"`
        }`,
      powershell: isFrontDoor
        ? `(Get-AzFrontDoorWafPolicy -Name "${policy}" -ResourceGroupName "${rg}").FrontendEndpointLink\nRemove-AzFrontDoorWafPolicy -Name "${policy}" -ResourceGroupName "${rg}"`
        : `(Get-AzApplicationGatewayFirewallPolicy -Name "${policy}" -ResourceGroupName "${rg}").ApplicationGateways\nRemove-AzApplicationGatewayFirewallPolicy -Name "${policy}" -ResourceGroupName "${rg}"`,
    };
  }

  return {
    cli: action.commandPayload || `az network application-gateway waf-policy show --name "${policy}" --resource-group "${rg}"`,
    powershell: `Get-AzApplicationGatewayFirewallPolicy -Name "${policy}" -ResourceGroupName "${rg}"`,
  };
}
