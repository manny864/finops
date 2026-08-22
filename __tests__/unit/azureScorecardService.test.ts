import { describe, it, expect } from "vitest";
import {
  sanitizeTeamTag,
  normalizeTeamName,
  groupByCanonicalTeam,
  calcTagHygieneScore,
  calcWasteScore,
  calcCommitmentScore,
  calcBudgetScore,
  deriveStatus,
  buildTeamScorecard,
  rankTeams,
  buildScorecardSummary,
  generateScorecardRecommendations,
  getMockScorecardPayload,
  assembleLiveScorecard,
  type RawTeamResource,
} from "@/services/azureScorecard.service";
import { PILLAR_MAX_POINTS, UNTAGGED_TEAM } from "@/types/azureScorecard.types";

describe("Scorecard — normalización de equipos", () => {
  it("sanea espacios, separadores y mayúsculas", () => {
    expect(sanitizeTeamTag("  IA  ")).toBe("ia");
    expect(sanitizeTeamTag("Cloud-Ops")).toBe("cloud ops");
    expect(sanitizeTeamTag("Cloud_Ops")).toBe("cloud ops");
    // Los valores de tag de ARG son siempre strings: cualquier otra cosa cae al
    // bucket de "sin asignar" en vez de convertirse en un equipo inventado.
    expect(sanitizeTeamTag(null)).toBe("");
    expect(sanitizeTeamTag(42)).toBe("");
    expect(normalizeTeamName(42)).toBe(UNTAGGED_TEAM);
  });

  it("fusiona las variantes del mismo equipo en un único nombre canónico", () => {
    // Sin esto el tablero muestra cuatro equipos fantasma con scores parciales.
    const canon = normalizeTeamName("IA");
    expect(normalizeTeamName("ai")).toBe(canon);
    expect(normalizeTeamName(" Artificial Intelligence ")).toBe(canon);
    expect(normalizeTeamName("machine-learning")).toBe(canon);
    expect(normalizeTeamName("FINOPS")).toBe(normalizeTeamName("cscs-finops"));
    expect(normalizeTeamName("CloudOps")).toBe(normalizeTeamName("cloud ops"));
  });

  it("un tag desconocido se conserva en PascalCase, no se descarta", () => {
    expect(normalizeTeamName("plataforma core")).toBe("Plataforma Core");
  });

  it("los recursos sin tag caen en un único bucket, no en cadenas vacías", () => {
    expect(normalizeTeamName("")).toBe(UNTAGGED_TEAM);
    expect(normalizeTeamName("   ")).toBe(UNTAGGED_TEAM);
    expect(normalizeTeamName(undefined)).toBe(UNTAGGED_TEAM);
  });

  it("agrupa registrando los alias fusionados para trazabilidad", () => {
    const g = groupByCanonicalTeam([{ teamTag: "IA" }, { teamTag: "ai" }, { teamTag: "Artificial Intelligence" }]);
    expect(g.size).toBe(1);
    const entry = Array.from(g.values())[0];
    expect(entry.items).toHaveLength(3);
    // El nombre canónico no cuenta como alias fusionado; sí las variantes.
    expect(entry.aliases.size).toBeGreaterThanOrEqual(2);
  });
});

describe("Scorecard — pilares de puntuación", () => {
  it("higiene de tags es proporcional a la cobertura", () => {
    expect(calcTagHygieneScore(10, 10)).toBe(PILLAR_MAX_POINTS.Tags);
    expect(calcTagHygieneScore(5, 10)).toBe(15);
    expect(calcTagHygieneScore(0, 10)).toBe(0);
  });

  it("sin recursos la higiene es 0, no el máximo", () => {
    expect(calcTagHygieneScore(0, 0)).toBe(0);
  });

  it("un equipo sin gasto no puntúa por evitar desperdicio", () => {
    // 30/30 aquí premiaría no tener nada, que es lo contrario del objetivo.
    expect(calcWasteScore(0, 0)).toBe(0);
    expect(calcWasteScore(0, 1000)).toBe(PILLAR_MAX_POINTS.Zombies);
  });

  it("descuenta el porcentaje del gasto que se va en zombis, con piso en cero", () => {
    expect(calcWasteScore(100, 1000)).toBe(20);
    expect(calcWasteScore(500, 1000)).toBe(0);
    // Un zombi más caro que el gasto reportado no genera score negativo.
    expect(calcWasteScore(2000, 1000)).toBe(0);
  });

  it("la cobertura de compromisos se acota a 0-100", () => {
    expect(calcCommitmentScore(100)).toBe(PILLAR_MAX_POINTS.Commitments);
    expect(calcCommitmentScore(50)).toBe(10);
    expect(calcCommitmentScore(-5)).toBe(0);
    expect(calcCommitmentScore(180)).toBe(PILLAR_MAX_POINTS.Commitments);
  });

  it("sin presupuesto asignado se otorga el puntaje completo", () => {
    // No tener presupuesto es una falla de gobernanza del tenant, no del equipo.
    expect(calcBudgetScore(9999, 0)).toBe(PILLAR_MAX_POINTS.Budget);
  });

  it("tolera un desvío del 5% y penaliza proporcionalmente por encima", () => {
    expect(calcBudgetScore(1000, 1000)).toBe(PILLAR_MAX_POINTS.Budget);
    expect(calcBudgetScore(1040, 1000)).toBe(PILLAR_MAX_POINTS.Budget);
    expect(calcBudgetScore(1200, 1000)).toBeLessThan(PILLAR_MAX_POINTS.Budget);
    expect(calcBudgetScore(5000, 1000)).toBe(0);
  });

  it("deriva el estado según el score y la inactividad", () => {
    expect(deriveStatus(95, false)).toBe("EXCELLENT");
    expect(deriveStatus(80, false)).toBe("GOOD");
    expect(deriveStatus(40, false)).toBe("NEEDS_ATTENTION");
    expect(deriveStatus(100, true)).toBe("INACTIVE");
  });
});

describe("Scorecard — armado y ranking", () => {
  const base = {
    teamId: "t",
    teamName: "T",
    mergedAliases: [],
    monthlySpendUSD: 1000,
    totalResources: 10,
    taggedResources: 10,
    untaggedResourceNames: [],
    zombieCostUSD: 0,
    zombieResourceNames: [],
    commitmentCoveragePercentage: 100,
    budgetUSD: 2000,
  };

  it("un equipo perfecto llega a 100 sin penalizaciones", () => {
    const t = buildTeamScorecard(base);
    expect(t.overallScore).toBe(100);
    expect(t.penalties).toHaveLength(0);
    expect(t.isInactive).toBe(false);
  });

  it("marca inactivo solo cuando no hay gasto NI recursos", () => {
    expect(buildTeamScorecard({ ...base, monthlySpendUSD: 0, totalResources: 0 }).isInactive).toBe(true);
    expect(buildTeamScorecard({ ...base, monthlySpendUSD: 0 }).isInactive).toBe(false);
  });

  it("desglosa la penalización con su impacto financiero", () => {
    const t = buildTeamScorecard({
      ...base,
      taggedResources: 6,
      untaggedResourceNames: ["vm-a", "vm-b", "vm-c", "vm-d"],
      zombieCostUSD: 150,
      zombieResourceNames: ["disk-huerfano"],
    });
    const tags = t.penalties.find((p) => p.pillar === "Tags")!;
    expect(tags.affectedResourcesCount).toBe(4);
    // 4 de 10 recursos sin etiquetar sobre 1000 USD → 400 USD sin atribuir.
    expect(tags.financialImpactUSD).toBe(400);
    const zombies = t.penalties.find((p) => p.pillar === "Zombies")!;
    expect(zombies.financialImpactUSD).toBe(150);
  });

  it("recorta la lista de recursos afectados a 10 pero conserva el conteo real", () => {
    const many = Array.from({ length: 25 }, (_, i) => `vm-${i}`);
    const t = buildTeamScorecard({ ...base, taggedResources: 0, totalResources: 25, untaggedResourceNames: many });
    const tags = t.penalties.find((p) => p.pillar === "Tags")!;
    expect(tags.affectedResourceNames).toHaveLength(10);
    expect(tags.affectedResourcesCount).toBe(25);
  });

  it("un equipo inactivo nunca queda por encima de uno activo", () => {
    // Sin esta regla un centro de costo vacío se lleva los 20 puntos del pilar
    // presupuestario y aparece arriba de equipos reales con score bajo.
    const activo = buildTeamScorecard({
      ...base,
      teamId: "activo",
      teamName: "Activo",
      taggedResources: 0,
      zombieCostUSD: 900,
      commitmentCoveragePercentage: 0,
      budgetUSD: 100,
    });
    const vacio = buildTeamScorecard({
      ...base,
      teamId: "vacio",
      teamName: "Vacio",
      monthlySpendUSD: 0,
      totalResources: 0,
      taggedResources: 0,
    });
    expect(vacio.overallScore).toBeGreaterThan(activo.overallScore);
    const ranked = rankTeams([vacio, activo]);
    expect(ranked[0].teamName).toBe("Activo");
    expect(ranked[0].rank).toBe(1);
    expect(ranked[1].status).toBe("INACTIVE");
  });
});

describe("Scorecard — resumen del tenant", () => {
  it("promedia ponderando por gasto, no por cantidad de equipos", () => {
    // Un equipo de 5 USD con score perfecto no debe compensar a uno de 5.000.
    const grande = buildTeamScorecard({
      teamId: "g",
      teamName: "Grande",
      mergedAliases: [],
      monthlySpendUSD: 5000,
      totalResources: 10,
      taggedResources: 0,
      untaggedResourceNames: [],
      zombieCostUSD: 0,
      zombieResourceNames: [],
      commitmentCoveragePercentage: 0,
      budgetUSD: 0,
    });
    const chico = buildTeamScorecard({
      teamId: "c",
      teamName: "Chico",
      mergedAliases: [],
      monthlySpendUSD: 5,
      totalResources: 1,
      taggedResources: 1,
      untaggedResourceNames: [],
      zombieCostUSD: 0,
      zombieResourceNames: [],
      commitmentCoveragePercentage: 100,
      budgetUSD: 0,
    });
    const s = buildScorecardSummary(rankTeams([grande, chico]));
    const promedioSimple = (grande.overallScore + chico.overallScore) / 2;
    expect(s.tenantAvgScore).toBeLessThan(promedioSimple);
    expect(s.activeTeamsCount).toBe(2);
  });

  it("un resumen sin equipos no divide por cero", () => {
    const s = buildScorecardSummary([]);
    expect(s.tenantAvgScore).toBe(0);
    expect(s.totalEvaluatedTeams).toBe(0);
    expect(s.topPerformingScore).toBe(0);
    expect(generateScorecardRecommendations(s)).toEqual([]);
  });

  it("contabiliza el gasto sin dueño por separado", () => {
    const payload = getMockScorecardPayload("demo-tenant-2222");
    expect(payload.summary.untaggedSpendUSD).toBeGreaterThan(0);
    expect(payload.summary.totalPenaltyWasteUSD).toBeGreaterThan(0);
  });
});

describe("Scorecard — dataset demo", () => {
  const payload = getMockScorecardPayload("demo-tenant-2222");

  it("es determinista y escala por tier", () => {
    expect(payload.source).toBe("mock");
    expect(getMockScorecardPayload("demo-tenant-2222").summary.tenantAvgScore).toBe(payload.summary.tenantAvgScore);
    const pro = getMockScorecardPayload("demo-1111");
    const ent = getMockScorecardPayload("demo-4444");
    expect(ent.summary.totalEvaluatedTeams).toBeGreaterThanOrEqual(pro.summary.totalEvaluatedTeams);
  });

  it("el dataset ejercita la fusión de alias", () => {
    const merged = payload.summary.teams.filter((t) => t.mergedAliases.length > 0);
    expect(merged.length).toBeGreaterThan(0);
  });

  it("los rangos son consecutivos y el líder es un equipo activo", () => {
    const ranks = payload.summary.teams.map((t) => t.rank);
    expect(ranks).toEqual(Array.from({ length: ranks.length }, (_, i) => i + 1));
    const lider = payload.summary.teams.find((t) => t.teamName === payload.summary.topPerformingTeam);
    expect(lider?.isInactive).toBe(false);
  });

  it("todo score está dentro de 0-100 y coincide con la suma de sus pilares", () => {
    for (const t of payload.summary.teams) {
      expect(t.overallScore).toBeGreaterThanOrEqual(0);
      expect(t.overallScore).toBeLessThanOrEqual(100);
      const suma = t.tagHygieneScore + t.wasteScore + t.commitmentScore + t.budgetDisciplineScore;
      expect(Math.abs(suma - t.overallScore)).toBeLessThan(0.2);
    }
  });

  it("propone remediaciones y solo la purga de zombis reclama ahorro", () => {
    expect(payload.remediations.length).toBeGreaterThan(0);
    for (const r of payload.remediations) {
      if (r.actionType !== "PURGE_ZOMBIE") expect(r.estimatedSavingsUSD).toBe(0);
    }
    expect(payload.remediations.some((r) => r.actionType === "PURGE_ZOMBIE")).toBe(true);
  });
});

describe("Scorecard — ensamblado en vivo", () => {
  const resources: RawTeamResource[] = [
    { teamTag: "IA", resourceName: "vm-1", isTagged: true, monthlySpendUSD: 0, isZombie: false },
    { teamTag: "ai", resourceName: "vm-2", isTagged: false, monthlySpendUSD: 0, isZombie: false },
    { teamTag: "Artificial Intelligence", resourceName: "disk-1", isTagged: true, monthlySpendUSD: 40, isZombie: true },
  ];

  it("fusiona alias y usa el gasto agregado por encima de la suma por recurso", () => {
    // La ruta solo resuelve costo a nivel de recurso para los zombis; sumar el
    // inventario daría 40 USD y un desperdicio del 100%.
    const canon = normalizeTeamName("IA");
    const p = assembleLiveScorecard({
      resources,
      spendByTeam: new Map([[canon, 1000]]),
      budgetsByTeam: new Map(),
      coverageByTeam: new Map([[canon, 50]]),
    });
    expect(p.source).toBe("live");
    expect(p.summary.teams).toHaveLength(1);
    const team = p.summary.teams[0];
    expect(team.monthlySpendUSD).toBe(1000);
    expect(team.zombieCostUSD).toBe(40);
    expect(team.wasteScore).toBe(26);
    expect(team.commitmentScore).toBe(10);
    expect(team.mergedAliases.length).toBeGreaterThan(0);
  });

  it("sin gasto agregado cae a la suma por recurso", () => {
    const p = assembleLiveScorecard({ resources, budgetsByTeam: new Map(), coverageByTeam: new Map() });
    expect(p.summary.teams[0].monthlySpendUSD).toBe(40);
  });

  it("un tenant sin recursos devuelve el estado vacío, nunca el dataset demo", () => {
    const p = assembleLiveScorecard({ resources: [], budgetsByTeam: new Map(), coverageByTeam: new Map() });
    expect(p.source).toBe("live");
    expect(p.summary.teams).toEqual([]);
    expect(p.summary.tenantAvgScore).toBe(0);
    expect(p.remediations).toEqual([]);
  });
});
