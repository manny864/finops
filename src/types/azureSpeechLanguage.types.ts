export interface SpeechLanguageResource {
  id: string;
  name: string;
  location: string;
  resourceGroup: string;
  subscriptionId: string;
  subscriptionName: string;
  kind: "SpeechServices" | "TextAnalytics" | "Language" | "TextTranslation" | "AIServices";
  skuName: "F0" | "S0" | "S1";
  audioHoursProcessed: number;
  charactersSynthesized: number;
  textRecordsProcessed: number;
  charactersTranslated: number;
  customVoiceEndpointsCount: number;
  customVoiceHostingCostUSD: number;
  totalCostUSD: number;
  isDevOrTest: boolean;
  isOrphan: boolean;
}

export interface SpeechLanguageSummary {
  totalCostUSD: number;
  totalAudioHours: number;
  totalCharactersTTS: number;
  totalTextRecordsNLP: number;
  totalCharactersTranslated: number;
  potentialSavingsUSD: number;
  breakdownByService: Array<{
    serviceName: string;
    costUSD: number;
    percentage: number;
    color: string;
  }>;
}

export interface SpeechLanguageRemediationAction {
  id: string;
  resourceId: string;
  title: string;
  description: string;
  category:
    | "CUSTOM_VOICE_UNPUBLISH"
    | "DEV_F0_DOWNGRADE"
    | "WHISPER_ARBITRAGE"
    | "NLP_BATCHING";
  estimatedSavingsUSD: number;
  confidence: "HIGH" | "MEDIUM";
  actionType: string;
  commandPayload?: string;
}

export interface SpeechLanguageDailyPoint {
  date: string;
  audioHours: number;
  charsTTSMillions: number;
  textRecordsK: number;
}

export interface SpeechLanguagePayload {
  summary: SpeechLanguageSummary;
  resources: SpeechLanguageResource[];
  dailyTrend: SpeechLanguageDailyPoint[];
  remediationActions: SpeechLanguageRemediationAction[];
  lastUpdated: string;
  source: "live" | "snapshot" | "mock";
}