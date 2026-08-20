import { NextRequest, NextResponse } from "next/server";
import { requireTenantAccess, AuthError } from "@/lib/requestAuth";
import { isMockTenant } from "@/lib/mockData";
import type {
  SpeechLanguagePayload,
  SpeechLanguageResource,
  SpeechLanguageSummary,
  SpeechLanguageDailyPoint,
  SpeechLanguageRemediationAction,
} from "@/types/azureSpeechLanguage.types";

// ─── Mock Data ───
function getMockSpeechLanguagePayload(): SpeechLanguagePayload {
  const now = new Date();
  const dailyTrend: SpeechLanguageDailyPoint[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    dailyTrend.push({
      date: d.toISOString().slice(0, 10),
      audioHours: Number((Math.random() * 5 + 2).toFixed(1)),
      charsTTSMillions: Number((Math.random() * 0.15 + 0.05).toFixed(2)),
      textRecordsK: Math.round(Math.random() * 30 + 10),
    });
  }

  const resources: SpeechLanguageResource[] = [
    {
      id: "/subscriptions/sub-001/resourceGroups/ai-speech-rg/providers/Microsoft.CognitiveServices/accounts/speech-prod-eastus",
      name: "speech-prod-eastus",
      location: "East US",
      resourceGroup: "ai-speech-rg",
      subscriptionId: "sub-001",
      subscriptionName: "Producción - Azure AI",
      kind: "SpeechServices",
      skuName: "S0",
      audioHoursProcessed: 98.5,
      charactersSynthesized: 2_800_000,
      textRecordsProcessed: 0,
      charactersTranslated: 0,
      customVoiceEndpointsCount: 2,
      customVoiceHostingCostUSD: 270,
      totalCostUSD: 1245.6,
      isDevOrTest: false,
      isOrphan: false,
    },
    {
      id: "/subscriptions/sub-001/resourceGroups/ai-speech-rg/providers/Microsoft.CognitiveServices/accounts/speech-custom-voice",
      name: "speech-custom-voice",
      location: "East US",
      resourceGroup: "ai-speech-rg",
      subscriptionId: "sub-001",
      subscriptionName: "Producción - Azure AI",
      kind: "SpeechServices",
      skuName: "S0",
      audioHoursProcessed: 0,
      charactersSynthesized: 150_000,
      textRecordsProcessed: 0,
      charactersTranslated: 0,
      customVoiceEndpointsCount: 1,
      customVoiceHostingCostUSD: 135,
      totalCostUSD: 138.5,
      isDevOrTest: false,
      isOrphan: true,
    },
    {
      id: "/subscriptions/sub-002/resourceGroups/dev-ai-rg/providers/Microsoft.CognitiveServices/accounts/lang-dev-westeu",
      name: "lang-dev-westeu",
      location: "West Europe",
      resourceGroup: "dev-ai-rg",
      subscriptionId: "sub-002",
      subscriptionName: "Desarrollo - Azure AI",
      kind: "Language",
      skuName: "S0",
      audioHoursProcessed: 0,
      charactersSynthesized: 0,
      textRecordsProcessed: 45_000,
      charactersTranslated: 0,
      customVoiceEndpointsCount: 0,
      customVoiceHostingCostUSD: 0,
      totalCostUSD: 320.75,
      isDevOrTest: true,
      isOrphan: false,
    },
    {
      id: "/subscriptions/sub-001/resourceGroups/ai-speech-rg/providers/Microsoft.CognitiveServices/accounts/translator-prod",
      name: "translator-prod",
      location: "East US",
      resourceGroup: "ai-speech-rg",
      subscriptionId: "sub-001",
      subscriptionName: "Producción - Azure AI",
      kind: "TextTranslation",
      skuName: "S1",
      audioHoursProcessed: 0,
      charactersSynthesized: 0,
      textRecordsProcessed: 0,
      charactersTranslated: 12_500_000,
      customVoiceEndpointsCount: 0,
      customVoiceHostingCostUSD: 0,
      totalCostUSD: 580.2,
      isDevOrTest: false,
      isOrphan: false,
    },
    {
      id: "/subscriptions/sub-001/resourceGroups/ai-speech-rg/providers/Microsoft.CognitiveServices/accounts/text-analytics-prod",
      name: "text-analytics-prod",
      location: "East US",
      resourceGroup: "ai-speech-rg",
      subscriptionId: "sub-001",
      subscriptionName: "Producción - Azure AI",
      kind: "TextAnalytics",
      skuName: "S0",
      audioHoursProcessed: 0,
      charactersSynthesized: 0,
      textRecordsProcessed: 320_000,
      charactersTranslated: 0,
      customVoiceEndpointsCount: 0,
      customVoiceHostingCostUSD: 0,
      totalCostUSD: 720.0,
      isDevOrTest: false,
      isOrphan: false,
    },
  ];

  const totalCostUSD = resources.reduce((sum, r) => sum + r.totalCostUSD, 0);
  const totalAudioHours = resources.reduce((sum, r) => sum + r.audioHoursProcessed, 0);
  const totalCharactersTTS = resources.reduce((sum, r) => sum + r.charactersSynthesized, 0);
  const totalTextRecordsNLP = resources.reduce((sum, r) => sum + r.textRecordsProcessed, 0);
  const totalCharactersTranslated = resources.reduce((sum, r) => sum + r.charactersTranslated, 0);

  const serviceCosts: Record<string, number> = {};
  for (const r of resources) {
    const key = r.kind === "SpeechServices" ? "Speech Services" :
      r.kind === "TextAnalytics" ? "Text Analytics" :
      r.kind === "Language" ? "Language (NLP)" :
      r.kind === "TextTranslation" ? "Translator" : "AI Services";
    serviceCosts[key] = (serviceCosts[key] || 0) + r.totalCostUSD;
  }

  const colors = ["#0078D4", "#2563EB", "#0284C7", "#38BDF8", "#94A3B8"];
  const breakdownByService = Object.entries(serviceCosts)
    .map(([serviceName, costUSD], i) => ({
      serviceName,
      costUSD: Number(costUSD.toFixed(2)),
      percentage: totalCostUSD > 0 ? Number(((costUSD / totalCostUSD) * 100).toFixed(1)) : 0,
      color: colors[i % colors.length],
    }))
    .sort((a, b) => b.costUSD - a.costUSD);

  const summary: SpeechLanguageSummary = {
    totalCostUSD: Number(totalCostUSD.toFixed(2)),
    totalAudioHours: Number(totalAudioHours.toFixed(1)),
    totalCharactersTTS,
    totalTextRecordsNLP,
    totalCharactersTranslated,
    potentialSavingsUSD: 455.75,
    breakdownByService,
  };

  const remediationActions: SpeechLanguageRemediationAction[] = [
    {
      id: "cv-unpublish-001",
      resourceId: resources[1].id,
      title: "Despublicar endpoint Custom Neural Voice inactivo",
      description:
        "El endpoint 'speech-custom-voice' tiene 0 llamadas en los últimos 30 días. El hosting de Custom Voice cuesta $4.50/día ($135/mes). Despublicar este endpoint ahorraría $135.00 USD/mes sin impacto en producción.",
      category: "CUSTOM_VOICE_UNPUBLISH",
      estimatedSavingsUSD: 135.0,
      confidence: "HIGH",
      actionType: "unpublish_endpoint",
    },
    {
      id: "dev-f0-001",
      resourceId: resources[2].id,
      title: "Downgrade a Free Tier F0 en instancia de desarrollo",
      description:
        "'lang-dev-westeu' está en SKU S0 pero procesa solo 45K text records/mes (muy por debajo del límite F0 de 5K/mes para operaciones estándar). Cambiar a F0 ahorraría ~$320/mes.",
      category: "DEV_F0_DOWNGRADE",
      estimatedSavingsUSD: 320.75,
      confidence: "HIGH",
      actionType: "downgrade_sku",
    },
    {
      id: "whisper-arb-001",
      resourceId: resources[0].id,
      title: "Arbitraje de transcripción batch a Whisper en AI Foundry",
      description:
        "'speech-prod-eastus' procesa 98.5h/mes de audio STT a ~$1/h. El modelo Whisper en Azure AI Foundry cuesta ~$0.36/h para batch. Migrar el 70% del volumen batch ahorraría ~$44/mes.",
      category: "WHISPER_ARBITRAGE",
      estimatedSavingsUSD: 44.1,
      confidence: "MEDIUM",
      actionType: "migrate_batch",
    },
  ];

  return {
    summary,
    resources,
    dailyTrend,
    remediationActions,
    lastUpdated: now.toISOString(),
    source: "mock",
  };
}

// ─── GET Handler ───
export async function GET(request: NextRequest) {
  try {
    const tenantId = request.nextUrl.searchParams.get("tenantId");
    const forceMock = request.nextUrl.searchParams.get("mock") === "true";
    const timeRange = request.nextUrl.searchParams.get("timeRange") || "MTD";

    if (!tenantId) {
      return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });
    }

    // Mock-first check
    if (forceMock || isMockTenant(tenantId)) {
      return NextResponse.json(getMockSpeechLanguagePayload());
    }

    // Real tenant: require auth
    await requireTenantAccess(request, tenantId, { allowSuperAdmin: true });

    // TODO: Integrate with real Azure Resource Graph + Cost Management + Monitor Metrics
    // For now, return empty state for real tenants without data
    const emptyPayload: SpeechLanguagePayload = {
      summary: {
        totalCostUSD: 0,
        totalAudioHours: 0,
        totalCharactersTTS: 0,
        totalTextRecordsNLP: 0,
        totalCharactersTranslated: 0,
        potentialSavingsUSD: 0,
        breakdownByService: [],
      },
      resources: [],
      dailyTrend: [],
      remediationActions: [],
      lastUpdated: new Date().toISOString(),
      source: "live",
    };

    return NextResponse.json(emptyPayload);
  } catch (err: unknown) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[speech-language] error:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}