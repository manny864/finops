// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const { queryMock, insertUsageMock, getGeminiModelMock, generateObjectMock, gateMock, prefsMock, logMock } = vi.hoisted(
  () => ({
    queryMock: vi.fn(),
    insertUsageMock: vi.fn(),
    getGeminiModelMock: vi.fn(),
    generateObjectMock: vi.fn(),
    gateMock: vi.fn(),
    prefsMock: vi.fn(),
    logMock: vi.fn(),
  })
);

vi.mock("@/modules/storage/db", () => ({
  default: { query: queryMock },
  insertPlatformAiUsage: insertUsageMock,
}));
vi.mock("@/modules/core/aiProvider", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/core/aiProvider")>()),
  AIProviderFactory: { getGeminiModel: getGeminiModelMock },
  aiQueue: { add: (fn: () => unknown) => fn() },
  withExponentialBackoff: (fn: () => unknown) => fn(),
  getDataSharingPrefs: prefsMock,
}));
vi.mock("ai", () => ({ generateObject: generateObjectMock }));
vi.mock("@/lib/aiFeatureGate", () => ({
  checkAiFeature: gateMock,
  AI_FEATURES: { "tag-value-normalization": { maxOutputTokens: 1000 } },
}));
vi.mock("@/lib/aiTelemetry", () => ({ logAiEvent: logMock, timeAiCall: (_f: string, fn: () => unknown) => fn() }));

import {
  buildAiBatch,
  getMockTagAiSuggestions,
  policyForAi,
  suggestTagValuesWithAi,
  validateAiItems,
  TAG_AI_BATCH_SIZE,
} from "@/services/tagValueAiSuggestion.service";
import { DEFAULT_MANDATORY_TAG_POLICIES } from "@/services/azureTagGovernance.service";
import {
  findMissingTag,
  groupNonConformingValues,
  RESOURCE_GROUP_TYPE,
  tagVocabulary,
  withTags,
} from "@/lib/tagNonConformities";
import type { TagValueAlias } from "@/lib/tagValueNormalizer";
import type { ResourceGroupTagAuditItem, ResourceTagAuditItem } from "@/types/azureTagGovernance.types";

const POLICIES = DEFAULT_MANDATORY_TAG_POLICIES;
const ALIASES = new Map<string, TagValueAlias[]>([["environment", [{ alias: "production", canonicalValue: "prod" }]]]);
const ROLE = POLICIES.find((p) => p.tagName === "Role")!;
const ENV = POLICIES.find((p) => p.tagName === "Environment")!;
const COST = POLICIES.find((p) => p.tagName === "CostCenter")!;

const vm = (name: string, rg: string, tags: Record<string, string>, type = "Microsoft.Compute/virtualMachines") =>
  withTags<ResourceTagAuditItem>(
    {
      id: `/subscriptions/s1/resourceGroups/${rg}/providers/${type}/${name}`,
      resourceName: name,
      resourceType: type,
      resourceTypeDisplay: type,
      subscriptionId: "S1",
      subscriptionName: "Sub",
      resourceGroup: rg,
      location: "eastus",
      complianceStatus: "COMPLIANT",
      currentTags: {},
      missingTags: [],
    },
    tags,
    POLICIES,
    ALIASES
  );
const rg = (name: string, tags: Record<string, string>) =>
  withTags<ResourceGroupTagAuditItem>(
    {
      id: `/subscriptions/s1/resourceGroups/${name}`,
      resourceGroupName: name,
      subscriptionId: "s1",
      subscriptionName: "Sub",
      location: "eastus",
      complianceStatus: "COMPLIANT",
      currentTags: {},
      missingTags: [],
      childResourcesCount: 1,
    },
    tags,
    POLICIES,
    ALIASES
  );

const FULL = { Environment: "prod", Role: "api", CostCenter: "Finance", Department: "CloudOps" };
const SCAN = {
  resources: [
    vm("vm-k8s-01", "rg-core", { ...FULL, Role: "k8s-cluster" }),
    vm("aks-k8s-02", "rg-core", { ...FULL, Role: "k8s-cluster" }, "Microsoft.ContainerService/managedClusters"),
    vm("vm-web", "rg-core", { Environment: "Production", role: "web", CostCenter: "Finance", Department: "CloudOps" }),
    vm("vm-ok", "rg-core", FULL),
    vm("vm-sin-cc", "rg-core", { Environment: "dev", Role: "api", Department: "CloudOps" }),
    vm("vm-sin-cc-2", "rg-libre", { Environment: "dev", Role: "api", Department: "CloudOps", Owner: "ana@empresa.com" }),
  ],
  resourceGroups: [
    rg("rg-core", { ...FULL, CostCenter: " Platform " }),
    rg("rg-libre", { Environment: "qa", Role: "pruebas" }),
  ],
};

const AI = { model: "m", modelName: "gpt-x", config: { source: "platform", provider: "azure" } };
const run = (mode: "normalize" | "fill", policy = mode === "normalize" ? ROLE : COST, scan = SCAN) =>
  suggestTagValuesWithAi({ tenantId: "t1", userKey: "ana@x.com", mode, policy, policies: POLICIES, loadSummary: async () => scan });
const promptOf = () => {
  const prompt: string = generateObjectMock.mock.calls[0][0].prompt;
  return JSON.parse(prompt.replace("<context_data>", "").replace("</context_data>", ""));
};

beforeEach(() => {
  queryMock.mockReset();
  queryMock.mockResolvedValue([[]]);
  insertUsageMock.mockReset();
  getGeminiModelMock.mockReset();
  getGeminiModelMock.mockResolvedValue(AI);
  generateObjectMock.mockReset();
  gateMock.mockReset();
  gateMock.mockResolvedValue({ allowed: true });
  prefsMock.mockReset();
  prefsMock.mockResolvedValue({ shareResourceNames: true, shareTags: true });
  logMock.mockReset();
});

describe("agrupación de lo que no cumple", () => {
  it("agrupa valores no permitidos por etiqueta y valor, de más a menos recursos", () => {
    const groups = groupNonConformingValues(SCAN.resources, SCAN.resourceGroups);
    expect(groups.map((g) => [g.tagName, g.value, g.targets.length, g.suggestion.normalized])).toEqual([
      ["Role", "k8s-cluster", 2, null],
      ["Environment", "Production", 1, "prod"],
      ["Role", "pruebas", 1, null],
      ["Role", "web", 1, null],
    ]);
    // La clave que se corrige es la escrita en el recurso ("role", no "Role").
    expect(groups[3].targets[0]).toMatchObject({ name: "vm-web", tagKey: "role" });
    expect(groups[2].targets[0]).toMatchObject({ name: "rg-libre", resourceType: RESOURCE_GROUP_TYPE });
  });

  it("encuentra faltantes con lo que heredarían de su grupo (sin distinguir mayúsculas de la suscripción)", () => {
    expect(findMissingTag(SCAN.resources, SCAN.resourceGroups, "CostCenter").map((c) => [c.resource.resourceName, c.inheritedValue])).toEqual([
      ["vm-sin-cc", "Platform"],
      ["vm-sin-cc-2", null],
    ]);
  });

  it("arma el vocabulario de la etiqueta con lo que el tenant ya usa, de más a menos usado", () => {
    expect(tagVocabulary(SCAN.resources, SCAN.resourceGroups, "costcenter")).toEqual(["Finance", "Platform"]);
    expect(tagVocabulary(SCAN.resources, SCAN.resourceGroups, "CostCenter", 1)).toEqual(["Finance"]);
  });

  it("withTags recalcula faltantes, valores no permitidos y estado", () => {
    const fixed = withTags(SCAN.resources[2], { ...FULL }, POLICIES);
    expect(fixed).toMatchObject({ missingTags: [], invalidTags: [], complianceStatus: "COMPLIANT" });
    expect(withTags(SCAN.resources[3], { Role: "api" }, POLICIES).missingTags).toEqual(["Environment", "CostCenter", "Department"]);
  });
});

describe("policyForAi", () => {
  it("normalize sólo sobre políticas con valores permitidos; fill sólo sobre libres obligatorias", () => {
    expect(policyForAi(POLICIES, "normalize", " role ")).toBe(ROLE);
    expect(policyForAi(POLICIES, "normalize", "CostCenter")).toBeNull();
    expect(policyForAi(POLICIES, "fill", "costcenter")).toBe(COST);
    expect(policyForAi(POLICIES, "fill", "Environment")).toBeNull();
    expect(policyForAi(POLICIES, "fill", "Owner")).toBeNull();
    expect(policyForAi([{ ...COST, isRequired: false }], "fill", "CostCenter")).toBeNull();
  });
});

describe("buildAiBatch", () => {
  it("normalize manda sólo el residuo de la etiqueta, con pistas si se comparten nombres", () => {
    const batch = buildAiBatch(SCAN, "normalize", ROLE, POLICIES, true);
    if (typeof batch === "string") throw new Error(batch);
    expect([...batch.targets.values()]).toEqual(["k8s-cluster", "pruebas", "web"]);
    expect(batch.vocabulary).toEqual(ROLE.allowedValues);
    expect(batch.context).toEqual({
      tag: "Role",
      allowedValues: ROLE.allowedValues,
      values: [
        {
          key: "v1",
          value: "k8s-cluster",
          resourceTypes: ["Microsoft.Compute/virtualMachines", "Microsoft.ContainerService/managedClusters"],
          resourceNames: ["vm-k8s-01", "aks-k8s-02"],
        },
        { key: "v2", value: "pruebas", resourceTypes: [RESOURCE_GROUP_TYPE], resourceNames: ["rg-libre"] },
        { key: "v3", value: "web", resourceTypes: ["Microsoft.Compute/virtualMachines"], resourceNames: ["vm-web"] },
      ],
    });
  });

  it("sin nombres compartidos, normalize manda sólo los valores", () => {
    const batch = buildAiBatch(SCAN, "normalize", ROLE, POLICIES, false);
    if (typeof batch === "string") throw new Error(batch);
    expect(batch.context.values).toEqual([
      { key: "v1", value: "k8s-cluster" },
      { key: "v2", value: "pruebas" },
      { key: "v3", value: "web" },
    ]);
  });

  it("lo que resolvió el normalizador no va a la IA", () => {
    expect(buildAiBatch(SCAN, "normalize", ENV, POLICIES, true)).toBe("nothing_to_resolve");
  });

  it("fill manda sólo los que no pueden heredar, con las etiquetas de las políticas", () => {
    const batch = buildAiBatch(SCAN, "fill", COST, POLICIES, true);
    if (typeof batch === "string") throw new Error(batch);
    expect(batch.vocabulary).toEqual(["Finance", "Platform"]);
    expect(batch.context).toEqual({
      tag: "CostCenter",
      knownValues: ["Finance", "Platform"],
      resources: [
        {
          key: "r1",
          name: "vm-sin-cc-2",
          type: "Microsoft.Compute/virtualMachines",
          resourceGroup: "rg-libre",
          tags: { Environment: "dev", Role: "api", Department: "CloudOps" },
        },
      ],
    });
    expect([...batch.targets.values()]).toEqual([SCAN.resources[5].id]);
  });

  it("fill sin valores en uso no tiene entre qué elegir", () => {
    const scan = { resources: [SCAN.resources[5]], resourceGroups: [] };
    expect(buildAiBatch(scan, "fill", COST, POLICIES, true)).toBe("no_vocabulary");
    expect(buildAiBatch({ resources: [SCAN.resources[3]], resourceGroups: [] }, "fill", COST, POLICIES, true)).toBe(
      "nothing_to_resolve"
    );
  });

  it("corta el lote en TAG_AI_BATCH_SIZE", () => {
    const resources = Array.from({ length: TAG_AI_BATCH_SIZE + 5 }, (_, i) => vm(`vm-${i}`, "rg-x", { ...FULL, Role: `raro-${i}` }));
    const batch = buildAiBatch({ resources, resourceGroups: [] }, "normalize", ROLE, POLICIES, false);
    if (typeof batch === "string") throw new Error(batch);
    expect(batch.targets.size).toBe(TAG_AI_BATCH_SIZE);
  });
});

describe("validateAiItems", () => {
  const targets = new Map([
    ["v1", "k8s-cluster"],
    ["v2", "pruebas"],
  ]);
  const vocab = ["orchestrator", "api"];
  it("acepta valores de la lista, UNKNOWN y claves faltantes", () => {
    expect(validateAiItems([{ key: "v1", value: "orchestrator", confidence: 0.9 }], targets, vocab)).toBeNull();
    expect(validateAiItems([{ key: "v2", value: "UNKNOWN", confidence: 0 }], targets, vocab)).toBeNull();
    expect(validateAiItems([], targets, vocab)).toBeNull();
  });
  it("rechaza claves desconocidas o repetidas, valores nuevos y confianzas fuera de rango", () => {
    expect(validateAiItems([{ key: "v9", value: "api", confidence: 1 }], targets, vocab)).toMatch(/desconocida/);
    expect(
      validateAiItems(
        [
          { key: "v1", value: "api", confidence: 1 },
          { key: "v1", value: "api", confidence: 1 },
        ],
        targets,
        vocab
      )
    ).toMatch(/repetida/);
    expect(validateAiItems([{ key: "v1", value: "kubernetes", confidence: 1 }], targets, vocab)).toMatch(/fuera de la lista/);
    expect(validateAiItems([{ key: "v1", value: "api", confidence: 1.2 }], targets, vocab)).toMatch(/confianza/);
    expect(validateAiItems([{ key: "v1", value: "api", confidence: NaN }], targets, vocab)).toMatch(/confianza/);
  });
});

describe("suggestTagValuesWithAi", () => {
  it("un denegado del gate no escanea ni llama al modelo", async () => {
    gateMock.mockResolvedValue({ allowed: false, reason: "tier" });
    const loadSummary = vi.fn();
    const r = await suggestTagValuesWithAi({ tenantId: "t1", userKey: "u", mode: "normalize", policy: ROLE, policies: POLICIES, loadSummary });
    expect(r).toEqual({ aiAvailable: false, reason: "tier" });
    expect(gateMock).toHaveBeenCalledWith("t1", "tag-value-normalization", "u");
    expect(loadSummary).not.toHaveBeenCalled();
    expect(generateObjectMock).not.toHaveBeenCalled();
  });

  it("si el tenant no comparte tags no sale nada", async () => {
    prefsMock.mockResolvedValue({ shareResourceNames: true, shareTags: false });
    expect(await run("normalize")).toEqual({ aiAvailable: false, reason: "dlp_tags" });
    expect(generateObjectMock).not.toHaveBeenCalled();
  });

  it("fill sin nombres compartidos no se manda; normalize sí, con los valores solos", async () => {
    prefsMock.mockResolvedValue({ shareResourceNames: false, shareTags: true });
    expect(await run("fill")).toEqual({ aiAvailable: false, reason: "dlp_names" });
    generateObjectMock.mockResolvedValue({ object: { items: [] }, usage: {} });
    await run("normalize");
    expect(promptOf().values[0]).toEqual({ key: "v1", value: "k8s-cluster" });
    expect(JSON.stringify(promptOf())).not.toContain("vm-k8s-01");
  });

  it("sin residuo no llama al modelo", async () => {
    expect(await run("normalize", ENV)).toEqual({ aiAvailable: false, reason: "nothing_to_resolve" });
    expect(generateObjectMock).not.toHaveBeenCalled();
  });

  it("devuelve una sugerencia por valor, con UNKNOWN y faltantes sin sugerencia, y la cachea", async () => {
    generateObjectMock.mockResolvedValue({
      object: {
        items: [
          { key: "v1", value: "orchestrator", confidence: 0.876 },
          { key: "v2", value: "UNKNOWN", confidence: 0.3 },
        ],
      },
      usage: { inputTokens: 400, outputTokens: 60 },
    });
    expect(await run("normalize")).toEqual({
      aiAvailable: true,
      mode: "normalize",
      tagName: "Role",
      suggestions: [
        { target: "k8s-cluster", suggestion: "orchestrator", confidence: 0.88 },
        { target: "pruebas", suggestion: null, confidence: 0 },
        { target: "web", suggestion: null, confidence: 0 },
      ],
    });
    const call = generateObjectMock.mock.calls[0][0];
    expect(call.maxOutputTokens).toBe(1000);
    expect(call.system).toMatch(/never invent/);
    expect(call.schema.safeParse({ items: [{ key: "v1", value: "nuevo", confidence: 1 }] }).success).toBe(false);
    expect(insertUsageMock).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "t1", feature: "tag-value-normalization", inputTokens: 400, outputTokens: 60 })
    );
    const cacheWrite = queryMock.mock.calls.find(([sql]) => String(sql).startsWith("REPLACE INTO AiCache"));
    expect(JSON.parse(cacheWrite![1][1]).items).toHaveLength(2);
  });

  it("fill propone sólo entre los valores en uso", async () => {
    generateObjectMock.mockResolvedValue({
      object: { items: [{ key: "r1", value: "Platform", confidence: 0.7 }] },
      usage: { inputTokens: 1, outputTokens: 1 },
    });
    expect(await run("fill")).toMatchObject({
      aiAvailable: true,
      suggestions: [{ target: SCAN.resources[5].id, suggestion: "Platform", confidence: 0.7 }],
    });
    expect(JSON.stringify(promptOf())).not.toContain("ana@empresa.com");
  });

  it("una salida que no valida se registra como rechazada y no se cachea", async () => {
    generateObjectMock.mockResolvedValue({
      object: { items: [{ key: "v7", value: "api", confidence: 0.9 }] },
      usage: { inputTokens: 1, outputTokens: 1 },
    });
    expect(await run("normalize")).toEqual({ aiAvailable: false, reason: "validation" });
    expect(logMock).toHaveBeenCalledWith("tag-value-normalization", { stage: "output", outcome: "rejected" });
    expect(queryMock.mock.calls.some(([sql]) => String(sql).startsWith("REPLACE"))).toBe(false);
  });

  it("con caché válida no llama al modelo", async () => {
    queryMock.mockResolvedValueOnce([[{ response_text: JSON.stringify({ items: [{ key: "v3", value: "frontend", confidence: 0.9 }] }) }]]);
    const r = await run("normalize");
    expect(r).toMatchObject({ aiAvailable: true, suggestions: [{ suggestion: null }, { suggestion: null }, { target: "web", suggestion: "frontend" }] });
    expect(generateObjectMock).not.toHaveBeenCalled();
    expect(getGeminiModelMock).not.toHaveBeenCalled();
  });

  it("una caché que ya no valida (cambió la lista) se ignora", async () => {
    queryMock.mockResolvedValueOnce([[{ response_text: JSON.stringify({ items: [{ key: "v1", value: "kubernetes", confidence: 1 }] }) }]]);
    generateObjectMock.mockResolvedValue({ object: { items: [] }, usage: {} });
    await run("normalize");
    expect(generateObjectMock).toHaveBeenCalledTimes(1);
  });

  it("sin modelo configurado o con error del proveedor devuelve el motivo", async () => {
    getGeminiModelMock.mockRejectedValueOnce(new Error("AI API Key not configured."));
    expect(await run("normalize")).toEqual({ aiAvailable: false, reason: "not_configured" });
    generateObjectMock.mockRejectedValueOnce(new Error("500"));
    expect(await run("normalize")).toEqual({ aiAvailable: false, reason: "error" });
    expect(insertUsageMock).not.toHaveBeenCalled();
  });
});

describe("demo", () => {
  it("sugiere sobre el escaneo mock sin llamar a la IA", () => {
    expect(getMockTagAiSuggestions("normalize", ROLE, POLICIES)).toEqual({
      aiAvailable: true,
      mode: "normalize",
      tagName: "Role",
      suggestions: [{ target: "k8s-cluster", suggestion: "orchestrator", confidence: 0.86 }],
    });
    expect(getMockTagAiSuggestions("normalize", ENV, POLICIES)).toMatchObject({
      suggestions: [{ target: "pruebas", suggestion: "qa" }],
    });
    const fill = getMockTagAiSuggestions("fill", COST, POLICIES);
    if (!fill.aiAvailable) throw new Error(fill.reason);
    expect(fill.suggestions.map((s) => [s.target.split("/").pop(), s.suggestion])).toEqual(
      expect.arrayContaining([
        ["vm-jumpbox-legacy", "CorePlatform"],
        ["pip-legacy-ingress-sbx", "CorePlatform"],
        ["adf-analytics-pipeline-dev", null],
      ])
    );
    expect(generateObjectMock).not.toHaveBeenCalled();
  });
});
