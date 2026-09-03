/**
 * FinOps Scorecard — Responsabilidad Financiera por Equipo
 *
 * RBAC mínimo: `Reader` (inventario y tags via Resource Graph) y
 * `Cost Management Reader` (gasto por equipo). Solo lectura.
 *
 * El scorecard solo sirve si los equipos están bien identificados. En la
 * práctica el mismo equipo aparece como `IA`, `ai`, `Artificial Intelligence`
 * y ` IA ` según quién creó el recurso; sin normalizar eso el tablero muestra
 * cuatro equipos fantasma con scores parciales en vez de uno real. Por eso el
 * pipeline de alias corre ANTES de cualquier cálculo.
 */

import { Decimal } from "decimal.js";
import { errorMessage } from "@/lib/apiErrors";
import {
  BUDGET_TOLERANCE_PERCENTAGE,
  PILLAR_MAX_POINTS,
  TEAM_ALIASES,
  UNTAGGED_TEAM,
  type ScorecardPayload,
  type ScorecardPenaltyItem,
  type ScorecardRemediationAction,
  type ScorecardStatus,
  type ScorecardSummaryMetrics,
  type TeamScorecardItem,
} from "@/types/azureScorecard.types";

// ─────────────────────────────────────────────────────────────────────────────
// Normalización de equipos (Alias Normalizer)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sanitiza un valor de tag antes de compararlo contra el diccionario de alias:
 * recorta, colapsa separadores (`-`, `_`, espacios múltiples) y baja a
 * minúsculas. `cscs-finops` y `CSCS FinOps` deben llegar al mismo string.
 */
export function sanitizeTeamTag(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw
    .trim()
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

/** Convierte a PascalCase con espacios: `data analytics` → `Data Analytics`. */
export function toDisplayCase(sanitized: string): string {
  return sanitized
    .split(" ")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Resuelve el nombre canónico de un equipo.
 * Los recursos sin tag caen a una entidad unificada en vez de desaparecer: su
 * gasto existe y alguien tiene que hacerse cargo.
 */
export function normalizeTeamName(raw: unknown): string {
  const sanitized = sanitizeTeamTag(raw);
  if (!sanitized) return UNTAGGED_TEAM;
  const alias = TEAM_ALIASES[sanitized];
  if (alias) return alias;
  return toDisplayCase(sanitized);
}

/** Agrupa recursos por equipo canónico, conservando las variantes fusionadas. */
export function groupByCanonicalTeam<T extends { teamTag?: unknown }>(
  items: T[]
): Map<string, { items: T[]; aliases: Set<string> }> {
  const out = new Map<string, { items: T[]; aliases: Set<string> }>();
  for (const item of items) {
    const canonical = normalizeTeamName(item.teamTag);
    const entry = out.get(canonical) || { items: [], aliases: new Set<string>() };
    entry.items.push(item);
    const raw = typeof item.teamTag === "string" ? item.teamTag.trim() : "";
    // Solo se registra como alias lo que difiere del canónico: si coinciden,
    // anotarlo sería ruido en la UI.
    if (raw && raw !== canonical) entry.aliases.add(raw);
    out.set(canonical, entry);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Motor de puntuación multi-pilar
// ─────────────────────────────────────────────────────────────────────────────

/** Pilar 1 — Higiene de tags: proporción de recursos con las tags obligatorias. */
export function calcTagHygieneScore(taggedResources: number, totalResources: number): number {
  if (totalResources <= 0) return 0;
  return new Decimal(taggedResources)
    .div(totalResources)
    .times(PILLAR_MAX_POINTS.Tags)
    .toDecimalPlaces(1)
    .toNumber();
}

/**
 * Pilar 2 — Ausencia de desperdicio: se descuenta la proporción del gasto del
 * equipo que se va en recursos zombie. Con gasto cero el score es 0, no 30:
 * un equipo sin gasto no "evitó desperdicio", simplemente no tiene nada.
 */
export function calcWasteScore(zombieCostUSD: number, totalSpendUSD: number): number {
  if (totalSpendUSD <= 0) return 0;
  const wastePct = new Decimal(Math.max(0, zombieCostUSD)).div(totalSpendUSD).times(100);
  return Decimal.max(new Decimal(PILLAR_MAX_POINTS.Zombies).minus(wastePct), 0)
    .toDecimalPlaces(1)
    .toNumber();
}

/** Pilar 3 — Cobertura de reservas y savings plans sobre el cómputo del equipo. */
export function calcCommitmentScore(coveragePercentage: number): number {
  const pct = Math.min(100, Math.max(0, coveragePercentage));
  return new Decimal(pct).div(100).times(PILLAR_MAX_POINTS.Commitments).toDecimalPlaces(1).toNumber();
}

/**
 * Pilar 4 — Disciplina presupuestaria. Sin presupuesto asignado no se puede
 * evaluar, y se otorga el puntaje completo en vez de castigar: el equipo no
 * eligió no tener presupuesto, eso es una falla de gobernanza del tenant que se
 * mide en el módulo de Salud, no acá.
 */
export function calcBudgetScore(spendUSD: number, budgetUSD: number): number {
  if (budgetUSD <= 0) return PILLAR_MAX_POINTS.Budget;
  if (spendUSD <= budgetUSD) return PILLAR_MAX_POINTS.Budget;
  const overPct = new Decimal(spendUSD).minus(budgetUSD).div(budgetUSD).times(100);
  if (overPct.lte(BUDGET_TOLERANCE_PERCENTAGE)) return PILLAR_MAX_POINTS.Budget;
  // Penalización proporcional al exceso, con piso en cero.
  const penalty = overPct.minus(BUDGET_TOLERANCE_PERCENTAGE).div(5);
  return Decimal.max(new Decimal(PILLAR_MAX_POINTS.Budget).minus(penalty), 0)
    .toDecimalPlaces(1)
    .toNumber();
}

export function deriveStatus(score: number, isInactive: boolean): ScorecardStatus {
  if (isInactive) return "INACTIVE";
  if (score >= 90) return "EXCELLENT";
  if (score >= 75) return "GOOD";
  return "NEEDS_ATTENTION";
}

/** Genera el desglose de puntos perdidos, con su impacto financiero. */
export function buildPenalties(team: {
  teamId: string;
  teamName: string;
  totalResources: number;
  taggedResources: number;
  untaggedResourceNames: string[];
  zombieCostUSD: number;
  zombieResourceNames: string[];
  monthlySpendUSD: number;
  commitmentCoveragePercentage: number;
  budgetUSD: number;
  tagHygieneScore: number;
  wasteScore: number;
  commitmentScore: number;
  budgetDisciplineScore: number;
}): ScorecardPenaltyItem[] {
  const out: ScorecardPenaltyItem[] = [];
  const untaggedCount = Math.max(0, team.totalResources - team.taggedResources);

  const tagLoss = Number((PILLAR_MAX_POINTS.Tags - team.tagHygieneScore).toFixed(1));
  if (tagLoss > 0) {
    const ids = team.untaggedResourceNames.slice(0, 10);
    const cmd =
      ids.length > 0
        ? `# Aplicar etiquetas obligatorias a recursos de ${team.teamName}\n` +
          `az resource tag --tags CostCenter="${team.teamName}" Environment="Production" Owner="${team.teamId}@company.com" \\\n  --ids ${ids.join(" ")}`
        : undefined;

    out.push({
      id: `${team.teamId}-tags`,
      pillar: "Tags",
      reason: `${untaggedCount} de ${team.totalResources} recurso(s) sin las etiquetas obligatorias`,
      reasonKey: "reason.tags",
      reasonParams: { untagged: untaggedCount, total: team.totalResources },
      pointsDeducted: tagLoss,
      // El impacto es el gasto que no se puede atribuir con confianza.
      financialImpactUSD:
        team.totalResources > 0
          ? Number(((team.monthlySpendUSD * untaggedCount) / team.totalResources).toFixed(2))
          : 0,
      affectedResourcesCount: untaggedCount,
      affectedResourceNames: ids,
      remediationActionType: "FIX_TAGS",
      commandPayload: cmd,
    });
  }

  const wasteLoss = Number((PILLAR_MAX_POINTS.Zombies - team.wasteScore).toFixed(1));
  if (wasteLoss > 0 && team.zombieCostUSD > 0) {
    const ids = team.zombieResourceNames.slice(0, 10);
    const cmd =
      ids.length > 0
        ? `# Purgar recursos huérfanos sin uso en ${team.teamName} (Ahorro: $${team.zombieCostUSD.toFixed(2)}/mes)\n` +
          ids.map((r) => `az resource delete --ids "${r}" --verbose`).join("\n")
        : undefined;

    out.push({
      id: `${team.teamId}-zombies`,
      pillar: "Zombies",
      reason: `${team.zombieResourceNames.length} recurso(s) huérfano(s) sin uso`,
      reasonKey: "reason.zombies",
      reasonParams: { count: team.zombieResourceNames.length },
      pointsDeducted: wasteLoss,
      financialImpactUSD: Number(team.zombieCostUSD.toFixed(2)),
      affectedResourcesCount: team.zombieResourceNames.length,
      affectedResourceNames: ids,
      remediationActionType: "PURGE_ZOMBIE",
      commandPayload: cmd,
    });
  }

  const commitLoss = Number((PILLAR_MAX_POINTS.Commitments - team.commitmentScore).toFixed(1));
  if (commitLoss > 0) {
    const cmd = `# Explorar recomendaciones de Savings Plans / Reservations para ${team.teamName}\naz consumption reservation recommendation list --scope "Subscription" --look-back-period "Last30Days"`;
    out.push({
      id: `${team.teamId}-commitments`,
      pillar: "Commitments",
      reason: `Solo ${team.commitmentCoveragePercentage}% del cómputo está cubierto por reservas o savings plans`,
      reasonKey: "reason.commitments",
      reasonParams: { pct: team.commitmentCoveragePercentage },
      pointsDeducted: commitLoss,
      // Oportunidad estimada: ~30% sobre el cómputo sin cubrir.
      financialImpactUSD: Number(
        ((team.monthlySpendUSD * (100 - team.commitmentCoveragePercentage)) / 100 * 0.3).toFixed(2)
      ),
      affectedResourcesCount: 0,
      affectedResourceNames: [],
      remediationActionType: "BUDGET_REVIEW",
      commandPayload: cmd,
    });
  }

  const budgetLoss = Number((PILLAR_MAX_POINTS.Budget - team.budgetDisciplineScore).toFixed(1));
  if (budgetLoss > 0) {
    const suggestedBudget = Math.ceil(team.monthlySpendUSD * 1.05);
    const cmd = `# Ajustar presupuesto mensual en Azure Consumption para ${team.teamName}\naz consumption budget create --budget-name "budget-${team.teamId}" --amount ${suggestedBudget} --time-grain Monthly`;
    out.push({
      id: `${team.teamId}-budget`,
      pillar: "Budget",
      reason: `Gasto de ${team.monthlySpendUSD.toFixed(2)} USD sobre un presupuesto de ${team.budgetUSD.toFixed(2)} USD`,
      reasonKey: "reason.budget",
      reasonParams: { spend: team.monthlySpendUSD.toFixed(2), budget: team.budgetUSD.toFixed(2) },
      pointsDeducted: budgetLoss,
      financialImpactUSD: Number(Math.max(0, team.monthlySpendUSD - team.budgetUSD).toFixed(2)),
      affectedResourcesCount: 0,
      affectedResourceNames: [],
      remediationActionType: "BUDGET_REVIEW",
      commandPayload: cmd,
    });
  }

  return out.sort((a, b) => b.pointsDeducted - a.pointsDeducted);
}

/** Ensambla el scorecard de un equipo a partir de sus datos crudos. */
export function buildTeamScorecard(input: {
  teamId: string;
  teamName: string;
  mergedAliases: string[];
  monthlySpendUSD: number;
  totalResources: number;
  taggedResources: number;
  untaggedResourceNames: string[];
  zombieCostUSD: number;
  zombieResourceNames: string[];
  commitmentCoveragePercentage: number;
  budgetUSD: number;
}): Omit<TeamScorecardItem, "rank"> {
  const isInactive = input.monthlySpendUSD <= 0 && input.totalResources === 0;

  const tagHygieneScore = calcTagHygieneScore(input.taggedResources, input.totalResources);
  const wasteScore = calcWasteScore(input.zombieCostUSD, input.monthlySpendUSD);
  const commitmentScore = calcCommitmentScore(input.commitmentCoveragePercentage);
  const budgetDisciplineScore = calcBudgetScore(input.monthlySpendUSD, input.budgetUSD);

  const overallScore = Number(
    (tagHygieneScore + wasteScore + commitmentScore + budgetDisciplineScore).toFixed(1)
  );

  return {
    teamId: input.teamId,
    teamName: input.teamName,
    mergedAliases: input.mergedAliases,
    monthlySpendUSD: Number(input.monthlySpendUSD.toFixed(2)),
    managedResourcesCount: input.totalResources,
    taggedResourcesCount: input.taggedResources,
    zombieCostUSD: Number(input.zombieCostUSD.toFixed(2)),
    commitmentCoveragePercentage: input.commitmentCoveragePercentage,
    budgetUSD: input.budgetUSD,
    tagHygieneScore,
    wasteScore,
    commitmentScore,
    budgetDisciplineScore,
    overallScore,
    penalties: buildPenalties({
      ...input,
      tagHygieneScore,
      wasteScore,
      commitmentScore,
      budgetDisciplineScore,
    }),
    status: deriveStatus(overallScore, isInactive),
    isInactive,
  };
}

/**
 * Ordena y asigna puestos.
 *
 * Regla de exclusión de inactividad: un equipo sin gasto y sin recursos NO
 * puede quedar por encima de uno activo. Sin esta regla, un centro de costo
 * vacío obtendría 20/100 por el pilar de presupuesto y aun así aparecería
 * arriba de equipos reales con score bajo — premiando no hacer nada.
 */
export function rankTeams(teams: Array<Omit<TeamScorecardItem, "rank">>): TeamScorecardItem[] {
  const active = teams.filter((t) => !t.isInactive).sort((a, b) => b.overallScore - a.overallScore);
  const inactive = teams.filter((t) => t.isInactive).sort((a, b) => a.teamName.localeCompare(b.teamName));
  return [...active, ...inactive].map((t, i) => ({ ...t, rank: i + 1 }));
}

export function buildScorecardSummary(teams: TeamScorecardItem[]): ScorecardSummaryMetrics {
  const active = teams.filter((t) => !t.isInactive);
  // El promedio se pondera por gasto: un equipo de $5 con score perfecto no
  // debe compensar a uno de $5.000 con score malo.
  const totalSpend = active.reduce((a, t) => a + t.monthlySpendUSD, 0);
  const weighted =
    totalSpend > 0
      ? active.reduce((a, t) => a + t.overallScore * t.monthlySpendUSD, 0) / totalSpend
      : active.length > 0
        ? active.reduce((a, t) => a + t.overallScore, 0) / active.length
        : 0;

  const top = active[0];
  return {
    tenantAvgScore: Number(weighted.toFixed(1)),
    topPerformingTeam: top?.teamName || "—",
    topPerformingScore: top?.overallScore || 0,
    totalEvaluatedTeams: teams.length,
    activeTeamsCount: active.length,
    totalPenaltyWasteUSD: Number(
      teams.reduce((a, t) => a + t.penalties.reduce((b, p) => b + p.financialImpactUSD, 0), 0).toFixed(2)
    ),
    untaggedSpendUSD: Number(
      (teams.find((t) => t.teamName === UNTAGGED_TEAM)?.monthlySpendUSD || 0).toFixed(2)
    ),
    teams,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Recomendaciones de cultura y gobernanza
// ─────────────────────────────────────────────────────────────────────────────

export function generateScorecardRecommendations(
  summary: ScorecardSummaryMetrics
): ScorecardRemediationAction[] {
  const out: ScorecardRemediationAction[] = [];

  const untagged = summary.teams.find((t) => t.teamName === UNTAGGED_TEAM);
  if (untagged && untagged.monthlySpendUSD > 0) {
    out.push({
      id: "assign-untagged",
      teamId: untagged.teamId,
      penaltyId: "",
      title: `Asignar ${untagged.managedResourcesCount} recurso(s) huérfano(s) a su departamento`,
      description: `${untagged.monthlySpendUSD.toFixed(
        2
      )} USD/mes de gasto no tiene dueño. Mientras siga sin etiquetar, ningún equipo lo ve en su scorecard y nadie tiene incentivo para optimizarlo: es el punto ciego más caro del modelo de responsabilidad.`,
      titleKey: "rec.untaggedTitle",
      titleParams: { count: untagged.managedResourcesCount },
      descriptionKey: "rec.untaggedDesc",
      descriptionParams: { amount: untagged.monthlySpendUSD.toFixed(2) },
      actionType: "FIX_TAGS",
      estimatedSavingsUSD: 0,
      confidence: "HIGH",
      commandPayload: `# Asignar tags de CostCenter y Owner a recursos no clasificados\naz tag create --name "CostCenter"`,
    });
  }

  // Campaña de zombis en el equipo con más desperdicio.
  const worstWaste = summary.teams
    .filter((t) => !t.isInactive && t.zombieCostUSD > 0)
    .sort((a, b) => b.zombieCostUSD - a.zombieCostUSD)[0];
  if (worstWaste) {
    const zombieCmd = worstWaste.penalties.find((p) => p.pillar === "Zombies")?.commandPayload;
    out.push({
      id: `purge-${worstWaste.teamId}`,
      teamId: worstWaste.teamId,
      penaltyId: `${worstWaste.teamId}-zombies`,
      title: `Campaña de remediación de zombis en ${worstWaste.teamName}`,
      description: `El equipo pierde ${worstWaste.zombieCostUSD.toFixed(
        2
      )} USD/mes en recursos huérfanos, lo que le cuesta ${(30 - worstWaste.wasteScore).toFixed(
        1
      )} puntos del scorecard. A diferencia de las otras penalizaciones, esta sí es ahorro directo: los recursos no se usan.`,
      titleKey: "rec.zombiesTitle",
      titleParams: { team: worstWaste.teamName },
      descriptionKey: "rec.zombiesDesc",
      descriptionParams: { amount: worstWaste.zombieCostUSD.toFixed(2), points: (30 - worstWaste.wasteScore).toFixed(1) },
      actionType: "PURGE_ZOMBIE",
      estimatedSavingsUSD: worstWaste.zombieCostUSD,
      confidence: "HIGH",
      commandPayload: zombieCmd || `# Purgar recursos zombis del equipo ${worstWaste.teamName}\naz resource list --tag CostCenter="${worstWaste.teamName}"`,
    });
  }

  // Equipos que necesitan atención: notificar al owner.
  const needsAttention = summary.teams.filter((t) => t.status === "NEEDS_ATTENTION");
  if (needsAttention.length > 0) {
    out.push({
      id: "notify-owners",
      teamId: "",
      penaltyId: "",
      title: `Enviar el scorecard mensual a ${needsAttention.length} equipo(s) por debajo de 75`,
      description: `${needsAttention
        .map((t) => t.teamName)
        .slice(0, 3)
        .join(", ")}${needsAttention.length > 3 ? "…" : ""} están por debajo del umbral. El scorecard solo cambia comportamiento si llega a quien puede actuar: automatizar el envío mensual al owner de cada departamento convierte la métrica en conversación.`,
      titleKey: "rec.notifyTitle",
      titleParams: { count: needsAttention.length },
      descriptionKey: "rec.notifyDesc",
      descriptionParams: { teams: needsAttention.map((t) => t.teamName).slice(0, 3).join(", ") + (needsAttention.length > 3 ? "…" : "") },
      actionType: "NOTIFY_OWNERS",
      estimatedSavingsUSD: 0,
      confidence: "MEDIUM",
      commandPayload: `# Disparar notificación de scorecard mensual a owners\ncurl -X POST "https://api.cscloudsolutions.com/v1/notifications/scorecard-digest" -H "Content-Type: application/json" -d '{"teams": ${JSON.stringify(needsAttention.map((t) => t.teamName))}}'`,
    });
  }

  return out.sort((a, b) => b.estimatedSavingsUSD - a.estimatedSavingsUSD);
}

// ─────────────────────────────────────────────────────────────────────────────
// Dataset sintético por tier (solo tenants demo — AGENTS.md #13)
// ─────────────────────────────────────────────────────────────────────────────

export function getMockScorecardPayload(tenantId: string): ScorecardPayload {
  const isEnterprise = tenantId.includes("4444");
  const isBusiness = tenantId.includes("2222") || isEnterprise;

  const raw = [
    {
      // Se declara con alias distintos a propósito: el normalizador debe
      // fusionarlos en un solo equipo.
      teamTag: "Engineering",
      aliases: ["engineering", "ENG", "Ingenieria"],
      spend: 4_820.5,
      resources: 62,
      tagged: 62,
      zombieCost: 0,
      zombies: [] as string[],
      coverage: 92,
      budget: 5_000,
    },
    {
      teamTag: "IA",
      aliases: ["IA", "ai", "Artificial Intelligence"],
      spend: 2_140.3,
      resources: 18,
      tagged: 15,
      zombieCost: 128.4,
      zombies: ["disk-ia-orphan-01", "pip-ia-unused"],
      coverage: 40,
      budget: 2_000,
    },
    {
      teamTag: "cscs-finops",
      aliases: ["cscs-finops", "FINOPS", "CloudOps"],
      spend: 980.15,
      resources: 24,
      tagged: 22,
      zombieCost: 41.2,
      zombies: ["snap-old-backup"],
      coverage: 78,
      budget: 1_200,
    },
    {
      teamTag: "Marketing",
      aliases: [],
      spend: 612.8,
      resources: 11,
      tagged: 7,
      zombieCost: 96.5,
      zombies: ["vm-mkt-poc", "disk-mkt-legacy", "pip-mkt-old"],
      coverage: 0,
      budget: 400,
    },
    {
      // Sin tag: cae a la entidad unificada.
      teamTag: "",
      aliases: [],
      spend: 731.6,
      resources: 19,
      tagged: 0,
      zombieCost: 212.9,
      zombies: ["nic-huerfana-01", "disk-sin-vm-02", "pip-sin-asignar"],
      coverage: 0,
      budget: 0,
    },
  ];

  if (isBusiness) {
    raw.push({
      teamTag: "data analytics",
      aliases: ["data", "BI"],
      spend: 1_845.9,
      resources: 31,
      tagged: 29,
      zombieCost: 55.0,
      zombies: ["adf-pipeline-huerfano"],
      coverage: 66,
      budget: 2_000,
    });
  }

  if (isEnterprise) {
    raw.push({
      // Equipo inactivo: sin gasto ni recursos. No debe quedar por encima de
      // los activos aunque su score de presupuesto sea perfecto.
      teamTag: "Legal",
      aliases: [],
      spend: 0,
      resources: 0,
      tagged: 0,
      zombieCost: 0,
      zombies: [],
      coverage: 0,
      budget: 500,
    });
  }

  const grouped = groupByCanonicalTeam(raw);
  const built = Array.from(grouped.entries()).map(([teamName, entry]) => {
    const agg = entry.items.reduce(
      (a, r) => ({
        spend: a.spend + r.spend,
        resources: a.resources + r.resources,
        tagged: a.tagged + r.tagged,
        zombieCost: a.zombieCost + r.zombieCost,
        zombies: [...a.zombies, ...r.zombies],
        coverage: r.coverage,
        budget: a.budget + r.budget,
      }),
      { spend: 0, resources: 0, tagged: 0, zombieCost: 0, zombies: [] as string[], coverage: 0, budget: 0 }
    );
    const untaggedNames = Array.from({ length: Math.max(0, agg.resources - agg.tagged) }, (_, i) =>
      `${teamName.toLowerCase().replace(/\W+/g, "-")}-sin-tag-${String(i + 1).padStart(2, "0")}`
    );
    return buildTeamScorecard({
      teamId: teamName.toLowerCase().replace(/\W+/g, "-"),
      teamName,
      mergedAliases: Array.from(new Set(entry.items.flatMap((i) => i.aliases))),
      monthlySpendUSD: agg.spend,
      totalResources: agg.resources,
      taggedResources: agg.tagged,
      untaggedResourceNames: untaggedNames,
      zombieCostUSD: agg.zombieCost,
      zombieResourceNames: agg.zombies,
      commitmentCoveragePercentage: agg.coverage,
      budgetUSD: agg.budget,
    });
  });

  const teams = rankTeams(built);
  const summary = buildScorecardSummary(teams);

  return {
    summary,
    remediations: generateScorecardRecommendations(summary),
    source: "mock",
    lastUpdated: new Date().toISOString(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Ensamblado vivo
// ─────────────────────────────────────────────────────────────────────────────

export interface RawTeamResource {
  teamTag?: unknown;
  resourceName: string;
  isTagged: boolean;
  monthlySpendUSD: number;
  isZombie: boolean;
}

function emptyPayload(): ScorecardPayload {
  return {
    summary: buildScorecardSummary([]),
    remediations: [],
    source: "live",
    lastUpdated: new Date().toISOString(),
  };
}

/**
 * Ensambla el scorecard a partir del inventario de recursos ya resuelto por la
 * ruta (Resource Graph + Cost Management + budgets). Mantenerlo así deja el
 * motor de puntuación testeable sin tocar Azure.
 */
export function assembleLiveScorecard(input: {
  resources: RawTeamResource[];
  /**
   * Gasto agregado por equipo desde Cost Management. Cuando existe, prevalece
   * sobre la suma de `monthlySpendUSD`: la ruta solo resuelve costo a nivel de
   * recurso para los zombies, asi que sumar el inventario daria un gasto de
   * equipo artificialmente bajo y un score de desperdicio del 0%.
   */
  spendByTeam?: Map<string, number>;
  budgetsByTeam: Map<string, number>;
  coverageByTeam: Map<string, number>;
}): ScorecardPayload {
  try {
    const grouped = groupByCanonicalTeam(input.resources);
    const built = Array.from(grouped.entries()).map(([teamName, entry]) => {
      const items = entry.items;
      const aggregated = input.spendByTeam?.get(teamName);
      const spend = aggregated !== undefined ? aggregated : items.reduce((a, r) => a + r.monthlySpendUSD, 0);
      const zombies = items.filter((r) => r.isZombie);
      return buildTeamScorecard({
        teamId: teamName.toLowerCase().replace(/\W+/g, "-"),
        teamName,
        mergedAliases: Array.from(entry.aliases),
        monthlySpendUSD: spend,
        totalResources: items.length,
        taggedResources: items.filter((r) => r.isTagged).length,
        untaggedResourceNames: items.filter((r) => !r.isTagged).map((r) => r.resourceName),
        zombieCostUSD: zombies.reduce((a, r) => a + r.monthlySpendUSD, 0),
        zombieResourceNames: zombies.map((r) => r.resourceName),
        commitmentCoveragePercentage: input.coverageByTeam.get(teamName) || 0,
        budgetUSD: input.budgetsByTeam.get(teamName) || 0,
      });
    });

    const teams = rankTeams(built);
    const summary = buildScorecardSummary(teams);
    return {
      summary,
      remediations: generateScorecardRecommendations(summary),
      source: "live",
      lastUpdated: new Date().toISOString(),
    };
  } catch (error) {
    console.error("[azureScorecard.service] assembleLiveScorecard:", errorMessage(error));
    return emptyPayload();
  }
}
