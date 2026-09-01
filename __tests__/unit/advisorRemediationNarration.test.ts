import { describe, it, expect, vi, beforeEach } from "vitest";

const { queryMock, getGeminiModelMock, generateTextMock, insertUsageMock } = vi.hoisted(() => ({
    queryMock: vi.fn(),
    getGeminiModelMock: vi.fn(),
    generateTextMock: vi.fn(),
    insertUsageMock: vi.fn(),
}));

vi.mock("@/modules/storage/db", () => ({
    default: { query: queryMock },
    insertPlatformAiUsage: insertUsageMock,
}));
vi.mock("@/modules/core/aiProvider", () => ({
    AIProviderFactory: { getGeminiModel: getGeminiModelMock },
    // Sin la cola/backoff reales: aiQueue.add serializa con 4s de espera entre
    // llamadas, que en un test unitario solo agregaría tiempo sin probar nada.
    aiQueue: { add: (fn: () => any) => fn() },
    withExponentialBackoff: (fn: () => any) => fn(),
}));
vi.mock("ai", () => ({ generateText: generateTextMock }));

import { narrateAdvisorRecommendations } from "@/services/advisorRemediationNarration";
import { generateAdvisorRemediationAction } from "@/lib/advisorRemediation";
import type { AdvisorRecommendation } from "@/types/azureAdvisor.types";

/** Construye una recomendación de RIGHTSIZE real (misma ruta que produce el
 *  servicio), no un mock a mano: así el test también verifica que las dos
 *  piezas (motor determinista + narrador) interoperan de verdad. Sus vars son
 *  {skuText, cpuText} — esta regla NO lleva {name} en la descripción. */
function rightsizeRec(name: string): Partial<AdvisorRecommendation> {
    const rec: Partial<AdvisorRecommendation> = {
        resourceName: name,
        titleTranslated: "Redimensionar recurso subutilizado",
        resource: { rawId: "", subscriptionId: "s1", resourceGroup: "rg", resourceType: "Microsoft.Compute/virtualMachines", resourceName: name },
        extendedProperties: { targetSku: "Standard_D2s_v5" },
    };
    rec.aiSuggestedAction = generateAdvisorRemediationAction(rec);
    return rec;
}

/** Idem, pero por la rama UPDATE_TAGS: su única var es {name}, útil para
 *  probar que dos recomendaciones con la MISMA regla no se cruzan el nombre. */
function tagsRec(name: string): Partial<AdvisorRecommendation> {
    const rec: Partial<AdvisorRecommendation> = {
        resourceName: name,
        titleTranslated: "Completar etiquetas obligatorias",
        resource: { rawId: "", subscriptionId: "s1", resourceGroup: "rg", resourceType: "Microsoft.Storage/storageAccounts", resourceName: name },
    };
    rec.aiSuggestedAction = generateAdvisorRemediationAction(rec);
    return rec;
}

beforeEach(() => {
    queryMock.mockReset().mockResolvedValue([[]]);
    getGeminiModelMock.mockReset().mockResolvedValue({
        model: {}, modelName: "gpt-4o", config: { source: "platform", provider: "openai" },
    });
    generateTextMock.mockReset();
    insertUsageMock.mockReset();
});

describe("narrateAdvisorRecommendations", () => {
    it("reescribe la descripción preservando los placeholders y los interpola con los datos del recurso", async () => {
        const rec = rightsizeRec("vm-mysql-01");
        generateTextMock.mockResolvedValue({
            text: "Bajar el tamaño asignado{skuText} evita pagar de más.{cpuText}",
            usage: { inputTokens: 40, outputTokens: 20 },
        });

        await narrateAdvisorRecommendations([rec as AdvisorRecommendation], "t1", "es");

        expect(rec.aiSuggestedAction!.actionDescription).toBe(
            "Bajar el tamaño asignado al SKU Standard_D2s_v5 evita pagar de más."
        );
        // Lo determinista no se toca.
        expect(rec.aiSuggestedAction!.actionType).toBe("RIGHTSIZE");
        expect(rec.aiSuggestedAction!.targetSku).toBe("Standard_D2s_v5");
        expect(rec.aiSuggestedAction!.actionTitle).toContain("vm-mysql-01");
    });

    it("una sola llamada a la IA para varias recomendaciones con la misma regla, cada una con su propio texto final", async () => {
        const recA = tagsRec("sa-a");
        const recB = tagsRec("sa-b");
        generateTextMock.mockResolvedValue({
            text: "Completar las etiquetas de {name} habilita el chargeback correcto.",
            usage: { inputTokens: 10, outputTokens: 10 },
        });

        await narrateAdvisorRecommendations([recA, recB] as AdvisorRecommendation[], "t1", "es");

        expect(generateTextMock).toHaveBeenCalledTimes(1);
        expect(recA.aiSuggestedAction!.actionDescription).toContain("sa-a");
        expect(recB.aiSuggestedAction!.actionDescription).toContain("sa-b");
        // Ninguna arrastra el nombre de la otra (la cache es por regla, no
        // guarda el texto ya interpolado).
        expect(recA.aiSuggestedAction!.actionDescription).not.toContain("sa-b");
        expect(recB.aiSuggestedAction!.actionDescription).not.toContain("sa-a");
    });

    it("usa la caché compartida (sin tenantId en el hash) y no vuelve a llamar a la IA", async () => {
        queryMock.mockImplementation(async (sql: string) => {
            if (String(sql).startsWith("SELECT")) {
                return [[{ response_text: "Plantilla cacheada para {name}.", created_at: new Date() }]];
            }
            return [[]];
        });
        const rec = tagsRec("sa-cache");

        await narrateAdvisorRecommendations([rec as AdvisorRecommendation], "t1", "es");

        expect(generateTextMock).not.toHaveBeenCalled();
        expect(rec.aiSuggestedAction!.actionDescription).toBe("Plantilla cacheada para sa-cache.");
    });

    // Salvaguarda de integridad: si el modelo se come un placeholder, el texto
    // interpola mal (un "{name" literal en pantalla) — peor que el determinista.
    it("si la IA rompe o pierde un placeholder, conserva el texto determinista", async () => {
        const rec = rightsizeRec("vm-broken");
        const original = rec.aiSuggestedAction!.actionDescription;
        generateTextMock.mockResolvedValue({
            text: "Bajar el tamaño asignado evita pagar de más.", // sin {skuText} ni {cpuText}
            usage: { inputTokens: 5, outputTokens: 5 },
        });

        await narrateAdvisorRecommendations([rec as AdvisorRecommendation], "t1", "es");

        expect(rec.aiSuggestedAction!.actionDescription).toBe(original);
    });

    it("tenant sin IA configurada: no toca nada y no explota", async () => {
        getGeminiModelMock.mockRejectedValue(new Error("AI API Key not configured."));
        const rec = rightsizeRec("vm-sin-ia");
        const original = rec.aiSuggestedAction!.actionDescription;

        await narrateAdvisorRecommendations([rec as AdvisorRecommendation], "t1", "es");

        expect(rec.aiSuggestedAction!.actionDescription).toBe(original);
        expect(generateTextMock).not.toHaveBeenCalled();
    });

    it("una lista vacía no llama a la IA", async () => {
        await narrateAdvisorRecommendations([], "t1", "es");
        expect(getGeminiModelMock).not.toHaveBeenCalled();
    });
});
