/**
 * Service: Azure FinOps Maturity Framework (Crawl, Walk, Run)
 * Focus: 6 FinOps Foundation domains (Visibility, Rate Opt, Usage Opt, Governance, Automation, Culture).
 */

import { ResourceGraphClient } from "@azure/arm-resourcegraph";
import { AdvisorManagementClient } from "@azure/arm-advisor";
import { ConsumptionManagementClient } from "@azure/arm-consumption";
import { getAzureCredential, getSubscriptionsForTenant } from "@/lib/azure";
import pool from "@/modules/storage/db";
import type {
  MaturityDimension,
  MaturityMilestone,
  MaturitySummary,
  MaturityPayload,
} from "@/types/finopsMaturity.types";
import {
  calculateMaturityStage,
  MATURITY_QUESTIONS,
} from "@/lib/finopsMaturityConstants";
import { errorMessage } from '@/lib/apiErrors';

export { calculateMaturityStage, MATURITY_QUESTIONS };

export function generateMockMaturityData(tier: string = "Enterprise"): MaturityPayload {
  const isEnt = tier.toLowerCase() === "enterprise";
  const isBus = tier.toLowerCase() === "business";

  const dimensions: MaturityDimension[] = [
    {
      key: "visibility",
      name: "Visibilidad e Información",
      score: isEnt ? 88 : isBus ? 72 : 38,
      stage: isEnt ? "RUN" : isBus ? "WALK" : "CRAWL",
      recommendationsCount: isEnt ? 1 : isBus ? 3 : 5,
      actionPlan: "Consolidar exportaciones FOCUS 1.0 y habilitar alertas de anomalías en tiempo real.",
    },
    {
      key: "rateOpt",
      name: "Optimización de Tasa",
      score: isEnt ? 82 : isBus ? 64 : 35,
      stage: isEnt ? "RUN" : isBus ? "WALK" : "CRAWL",
      recommendationsCount: isEnt ? 2 : isBus ? 4 : 6,
      actionPlan: "Aumentar cobertura de Savings Plans a 3 años y aplicar Azure Hybrid Benefit en SQL Managed Instances.",
    },
    {
      key: "usageOpt",
      name: "Optimización de Uso",
      score: isEnt ? 76 : isBus ? 68 : 42,
      stage: isEnt ? "RUN" : isBus ? "WALK" : "WALK",
      recommendationsCount: isEnt ? 3 : isBus ? 5 : 7,
      actionPlan: "Redimensionar 8 instancias subutilizadas y programar auto-apagado en clústeres de pruebas.",
    },
    {
      key: "governance",
      name: "Gobernanza y Asignación",
      score: isEnt ? 85 : isBus ? 70 : 45,
      stage: isEnt ? "RUN" : isBus ? "WALK" : "WALK",
      recommendationsCount: isEnt ? 1 : isBus ? 2 : 4,
      actionPlan: "Aplicar Azure Policy en modo Deny para recursos sin etiquetas Environment y CostCenter.",
    },
    {
      key: "automation",
      name: "Automatización",
      score: isEnt ? 78 : isBus ? 55 : 25,
      stage: isEnt ? "RUN" : isBus ? "WALK" : "CRAWL",
      recommendationsCount: isEnt ? 2 : isBus ? 4 : 8,
      actionPlan: "Implementar Runbooks de encendido/apagado automático y auto-purga de discos huérfanos.",
    },
    {
      key: "culture",
      name: "Cultura FinOps",
      score: isEnt ? 80 : isBus ? 60 : 32,
      stage: isEnt ? "RUN" : isBus ? "WALK" : "CRAWL",
      recommendationsCount: isEnt ? 1 : isBus ? 3 : 5,
      actionPlan: "Instituir revisiones mensuales de costo unitario por producto con líderes de ingeniería.",
    },
  ];

  const overallScore = Math.round(
    dimensions.reduce((acc, d) => acc + d.score, 0) / dimensions.length
  );
  const overallStage = calculateMaturityStage(overallScore);

  const nextMilestones: MaturityMilestone[] = [
    {
      dimensionKey: "automation",
      fromStage: overallStage === "CRAWL" ? "Gatear" : "Caminar",
      toStage: overallStage === "CRAWL" ? "Caminar" : "Correr",
      title: "Habilitar Runbooks de auto-apagado en ambientes Dev/Test",
      description: "Automatizar el apagado fuera de horario laboral reduce hasta un 65% del costo de cómputo no productivo.",
      actionType: "ENABLE_POWER_SCHEDULES",
      estimatedEffort: "Bajo",
      impactScore: 18,
      commandPayload: "az automation runbook create --name 'AutoShutdown-Dev' --type 'PowerShell'",
    },
    {
      dimensionKey: "rateOpt",
      fromStage: overallStage === "CRAWL" ? "Gatear" : "Caminar",
      toStage: overallStage === "CRAWL" ? "Caminar" : "Correr",
      title: "Consolidar cobertura de Compute Savings Plans",
      description: "Adquirir compromisos a 1 o 3 años para cargas base con más de 70% de estabilidad horaria.",
      actionType: "BUY_SAVINGS_PLANS",
      estimatedEffort: "Medio",
      impactScore: 15,
      commandPayload: "az reservations reservation-order calculate --applied-scope-type Shared",
    },
    {
      dimensionKey: "governance",
      fromStage: "Caminar",
      toStage: "Correr",
      title: "Auditoría estricta de Tags con Azure Policy",
      description: "Desplegar directiva de cumplimiento para garantizar 100% de asignación de costos a centros de costo.",
      actionType: "ENFORCE_TAGGING_POLICY",
      estimatedEffort: "Bajo",
      impactScore: 12,
      commandPayload: "az policy assignment create --name 'require-costcenter-tag' --policy '1e30110a-5ceb-460c-a204-c14969fa3a3b'",
    },
  ];

  return {
    success: true,
    summary: {
      overallScore,
      overallStage,
      dimensions,
      nextMilestones,
    },
    tenantName: "CSCloudSolutions Infra (Demo)",
    tier,
    assessmentQuestions: MATURITY_QUESTIONS,
    lastAssessed: new Date().toISOString().slice(0, 10),
    source: "mock",
  };
}

/**
 * Última autoevaluación guardada del tenant, mapeada por dominio.
 *
 * `MaturityAssessments.assessment_data` guarda `[{ id, score }]` con el id de la
 * pregunta; cada pregunta declara su `domainKey`, que coincide 1:1 con la `key`
 * de las dimensiones del radar. Sin esto el cuestionario se persistía pero el
 * gráfico no se movía: las 6 dimensiones se calculaban sólo con telemetría.
 */
export async function getLatestSelfAssessment(
  tenantId: string
): Promise<{ scoresByDomain: Record<string, number>; assessedAtIso: string | null }> {
  const scoresByDomain: Record<string, number> = {};
  try {
    const [rows]: any = await pool.query(
      `SELECT assessment_data, created_at FROM MaturityAssessments
        WHERE tenant_id = ? ORDER BY created_at DESC, id DESC LIMIT 1`,
      [tenantId]
    );
    const row = rows?.[0];
    if (!row) return { scoresByDomain, assessedAtIso: null };

    const raw = typeof row.assessment_data === "string"
      ? JSON.parse(row.assessment_data)
      : row.assessment_data;
    const answers: Array<{ id?: string; score?: number }> = Array.isArray(raw) ? raw : [];
    for (const answer of answers) {
      const question = MATURITY_QUESTIONS.find((q) => q.id === answer.id);
      const score = Number(answer.score);
      if (question && Number.isFinite(score)) {
        scoresByDomain[question.domainKey] = Math.max(0, Math.min(100, score));
      }
    }
    const assessedAtIso = row.created_at ? new Date(row.created_at).toISOString() : null;
    return { scoresByDomain, assessedAtIso };
  } catch (e) {
    console.warn("[maturity] no se pudo leer la última autoevaluación:", errorMessage(e));
    return { scoresByDomain, assessedAtIso: null };
  }
}

/**
 * Aplica la autoevaluación sobre las dimensiones calculadas por telemetría.
 *
 * El módulo ES una autoevaluación (modelo Crawl-Walk-Run de la FinOps
 * Foundation), así que la respuesta del equipo manda sobre su dominio y la
 * telemetría queda como contraste: cuando divergen más de 20 puntos se anota en
 * el plan de acción, que es justamente la conversación FinOps útil.
 */
export function applySelfAssessment(
  dimensions: MaturityDimension[],
  scoresByDomain: Record<string, number>
): MaturityDimension[] {
  if (Object.keys(scoresByDomain).length === 0) return dimensions;
  return dimensions.map((dim) => {
    const declared = scoresByDomain[dim.key];
    if (declared === undefined) return dim;
    const telemetryScore = dim.score;
    const gap = declared - telemetryScore;
    const divergenceNote =
      Math.abs(gap) > 20
        ? gap > 0
          ? ` Autoevaluación declara ${declared}/100 pero la telemetría sugiere ${telemetryScore}/100: validar la evidencia antes de dar el dominio por maduro.`
          : ` La telemetría (${telemetryScore}/100) va por delante de la autoevaluación (${declared}/100): puede haber capacidades ya implementadas sin documentar.`
        : "";
    return {
      ...dim,
      score: declared,
      stage: calculateMaturityStage(declared),
      telemetryScore,
      scoreSource: "self_assessment" as const,
      actionPlan: `${dim.actionPlan}${divergenceNote}`,
    };
  });
}

export async function getLiveMaturityData(tenantId: string): Promise<MaturityPayload> {
  try {
    const credential = await getAzureCredential(tenantId);
    const subs = await getSubscriptionsForTenant(tenantId, credential);

    if (!subs || subs.length === 0) {
      const emptyDimensions: MaturityDimension[] = [
        { key: "visibility", name: "Visibilidad e Información", score: 0, stage: "CRAWL", recommendationsCount: 0, actionPlan: "Conectar suscripciones de Azure para evaluar visibilidad." },
        { key: "rateOpt", name: "Optimización de Tasa", score: 0, stage: "CRAWL", recommendationsCount: 0, actionPlan: "Conectar suscripciones para evaluar compromisos." },
        { key: "usageOpt", name: "Optimización de Uso", score: 0, stage: "CRAWL", recommendationsCount: 0, actionPlan: "Conectar suscripciones para evaluar sobredimensionamiento." },
        { key: "governance", name: "Gobernanza y Asignación", score: 0, stage: "CRAWL", recommendationsCount: 0, actionPlan: "Conectar suscripciones para auditar etiquetas." },
        { key: "automation", name: "Automatización", score: 0, stage: "CRAWL", recommendationsCount: 0, actionPlan: "Conectar suscripciones para evaluar políticas." },
        { key: "culture", name: "Cultura FinOps", score: 0, stage: "CRAWL", recommendationsCount: 0, actionPlan: "Completar la primera autoevaluación FinOps." },
      ];
      // Sin suscripciones conectadas la telemetría es 0, pero la autoevaluación
      // sí debe reflejarse: es el único insumo que tiene el tenant todavía.
      const selfNoSubs = await getLatestSelfAssessment(tenantId);
      const dimsNoSubs = applySelfAssessment(emptyDimensions, selfNoSubs.scoresByDomain);
      const overallNoSubs = Math.round(
        dimsNoSubs.reduce((acc, d) => acc + d.score, 0) / Math.max(1, dimsNoSubs.length)
      );
      return {
        success: true,
        summary: {
          overallScore: overallNoSubs,
          overallStage: calculateMaturityStage(overallNoSubs),
          dimensions: dimsNoSubs,
          nextMilestones: [],
        },
        tenantName: tenantId,
        tier: "Enterprise",
        assessmentQuestions: MATURITY_QUESTIONS,
        lastAssessed: selfNoSubs.assessedAtIso || undefined,
        source: "live",
      };
    }

    let budgetCount = 0;
    let costRecCount = 0;
    let securityRecCount = 0;
    let totalAdvisorCount = 0;
    let advisorAccessible = false;

    // 1. Escanear presupuestos y Advisor
    for (const subId of subs.slice(0, 5)) {
      try {
        const consumptionClient = new ConsumptionManagementClient(credential, subId);
        for await (const _b of consumptionClient.budgets.list(`subscriptions/${subId}`)) {
          budgetCount++;
        }
      } catch {
        // Sin acceso a budgets en esta sub
      }

      try {
        const advisorClient = new AdvisorManagementClient(credential, subId);
        for await (const rec of advisorClient.recommendations.list()) {
          totalAdvisorCount++;
          if (rec.category === "Cost") costRecCount++;
          if (rec.category === "Security") securityRecCount++;
        }
        advisorAccessible = true;
      } catch {
        // Sin acceso a Advisor en esta sub
      }
    }

    // 2. Consulta ARG para cumplimiento de Tags
    let tagCoveragePct = 50;
    try {
      const argClient = new ResourceGraphClient(credential);
      const tagQuery = `
        resources
        | summarize
            total = count(),
            withEnv = countif(isnotnull(tags.Environment) or isnotnull(tags.environment) or isnotnull(tags.ENV)),
            withCostCenter = countif(isnotnull(tags.CostCenter) or isnotnull(tags.costcenter) or isnotnull(tags.CentroCosto))
      `;
      const tagRes = await argClient.resources({ query: tagQuery, subscriptions: subs });
      const row = (tagRes.data as any[])?.[0];
      if (row && row.total > 0) {
        const envPct = (row.withEnv / row.total) * 100;
        const ccPct = (row.withCostCenter / row.total) * 100;
        tagCoveragePct = Math.round((envPct + ccPct) / 2);
      }
    } catch {
      // ARG tag query fallback
    }

    const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

    // Cálculo de dimensiones
    const visScore = clamp(30 + (subs.length > 1 ? 15 : 5) + (budgetCount > 0 ? 30 : 10) + (advisorAccessible ? 20 : 0));
    const rateScore = advisorAccessible ? clamp(85 - costRecCount * 5) : 45;
    const usageScore = advisorAccessible ? clamp(90 - costRecCount * 7) : 40;
    const govScore = clamp(tagCoveragePct);
    const autoScore = advisorAccessible ? clamp(75 - securityRecCount * 4) : 35;
    const cultureScore = clamp((visScore + govScore) / 2);

    const dimensions: MaturityDimension[] = [
      {
        key: "visibility",
        name: "Visibilidad e Información",
        score: visScore,
        stage: calculateMaturityStage(visScore),
        recommendationsCount: budgetCount === 0 ? 2 : 0,
        actionPlan: budgetCount === 0 ? "Crear presupuestos por suscripción en Azure Cost Management." : "Exportar reportes de costos periódicos.",
      },
      {
        key: "rateOpt",
        name: "Optimización de Tasa",
        score: rateScore,
        stage: calculateMaturityStage(rateScore),
        recommendationsCount: costRecCount > 0 ? 3 : 1,
        actionPlan: "Evaluar compromisos de Savings Plans para cargas permanentes.",
      },
      {
        key: "usageOpt",
        name: "Optimización de Uso",
        score: usageScore,
        stage: calculateMaturityStage(usageScore),
        recommendationsCount: costRecCount,
        actionPlan: "Implementar recomendaciones de redimensionamiento detectadas por Azure Advisor.",
      },
      {
        key: "governance",
        name: "Gobernanza y Asignación",
        score: govScore,
        stage: calculateMaturityStage(govScore),
        recommendationsCount: tagCoveragePct < 80 ? 2 : 0,
        actionPlan: `Cumplimiento actual de etiquetas: ${tagCoveragePct}%. Habilitar Azure Policy para tags obligatorias.`,
      },
      {
        key: "automation",
        name: "Automatización",
        score: autoScore,
        stage: calculateMaturityStage(autoScore),
        recommendationsCount: 2,
        actionPlan: "Configurar apagado automático en máquinas virtuales de ambientes no productivos.",
      },
      {
        key: "culture",
        name: "Cultura FinOps",
        score: cultureScore,
        stage: calculateMaturityStage(cultureScore),
        recommendationsCount: 1,
        actionPlan: "Completar la autoevaluación interactiva con el equipo técnico y financiero.",
      },
    ];

    // La autoevaluación manda sobre su dominio (ver applySelfAssessment): sin
    // esto el cuestionario se guardaba y el radar seguía igual.
    const selfAssessment = await getLatestSelfAssessment(tenantId);
    const effectiveDimensions = applySelfAssessment(dimensions, selfAssessment.scoresByDomain);

    const overallScore = Math.round(
      effectiveDimensions.reduce((acc, d) => acc + d.score, 0) / effectiveDimensions.length
    );
    const overallStage = calculateMaturityStage(overallScore);

    const nextMilestones: MaturityMilestone[] = [
      {
        dimensionKey: "governance",
        fromStage: govScore < 40 ? "Gatear" : "Caminar",
        toStage: govScore < 40 ? "Caminar" : "Correr",
        title: "Incrementar cobertura de Tags obligatorias",
        description: `El cumplimiento de etiquetas en los recursos es del ${tagCoveragePct}%. Elevarlo sobre el 85% asegura showback exacto.`,
        actionType: "ENFORCE_TAGGING_POLICY",
        estimatedEffort: "Bajo",
        impactScore: 15,
        commandPayload: "az policy assignment create --name 'enforce-tags' --policy '1e30110a-5ceb-460c-a204-c14969fa3a3b'",
      },
      {
        dimensionKey: "rateOpt",
        fromStage: rateScore < 40 ? "Gatear" : "Caminar",
        toStage: rateScore < 40 ? "Caminar" : "Correr",
        title: "Optimizar tarifas con Azure Reservations y Savings Plans",
        description: "Revisar y ejecutar las oportunidades de compra de capacidad reservada identificadas.",
        actionType: "BUY_SAVINGS_PLANS",
        estimatedEffort: "Medio",
        impactScore: 20,
      },
      {
        dimensionKey: "visibility",
        fromStage: "Gatear",
        toStage: "Caminar",
        title: "Configurar presupuestos y alertas de consumo",
        description: "Establecer límites de gasto mensuales por suscripción con alertas tempranas al 80% y 100%.",
        actionType: "CREATE_BUDGETS",
        estimatedEffort: "Bajo",
        impactScore: 10,
      },
    ];

    return {
      success: true,
      summary: {
        overallScore,
        overallStage,
        dimensions: effectiveDimensions,
        nextMilestones,
      },
      tenantName: tenantId,
      tier: "Enterprise",
      assessmentQuestions: MATURITY_QUESTIONS,
      // Fecha de la autoevaluación real, no "hoy": es lo que la UI muestra como
      // última evaluación y antes cambiaba en cada refresh sin haber evaluado.
      lastAssessed: selfAssessment.assessedAtIso
        ? selfAssessment.assessedAtIso.slice(0, 10)
        : undefined,
      source: "live",
    };
  } catch (error) {
    console.warn("[azureMaturity.service] Live maturity calculation error:", errorMessage(error));
    const baselineDimensions: MaturityDimension[] = [
      { key: "visibility", name: "Visibilidad e Información", score: 0, stage: "CRAWL", recommendationsCount: 0, actionPlan: "Conectar suscripciones y configurar visibilidad de costos." },
      { key: "rateOpt", name: "Optimización de Tasa", score: 0, stage: "CRAWL", recommendationsCount: 0, actionPlan: "Evaluar compromisos y beneficios de precios." },
      { key: "usageOpt", name: "Optimización de Uso", score: 0, stage: "CRAWL", recommendationsCount: 0, actionPlan: "Monitorear utilización de recursos." },
      { key: "governance", name: "Gobernanza y Asignación", score: 0, stage: "CRAWL", recommendationsCount: 0, actionPlan: "Definir políticas de etiquetado y gobernanza." },
      { key: "culture", name: "Cultura y Rendición de Cuentas", score: 0, stage: "CRAWL", recommendationsCount: 0, actionPlan: "Asignar centros de costo y responsables." },
    ];
    return {
      success: false,
      summary: {
        overallScore: 0,
        overallStage: "CRAWL",
        dimensions: baselineDimensions,
        nextMilestones: [],
      },
      tenantName: tenantId,
      tier: "Enterprise",
      assessmentQuestions: MATURITY_QUESTIONS,
      source: "live",
    };
  }
}

export async function getFinOpsMaturityAssessment(
  tenantId: string,
  tier: string = "Enterprise",
  isMock: boolean = true
): Promise<MaturitySummary> {
  if (isMock) {
    const data = generateMockMaturityData(tier);
    return data.summary;
  }
  const data = await getLiveMaturityData(tenantId);
  return data.summary;
}

export function recalculateMaturityWithAssessment(
  currentSummary: MaturitySummary,
  answers: Array<{ questionId: string; dimensionKey: string; score: number }>
): MaturitySummary {
  const updatedDimensions = currentSummary.dimensions.map((dim) => {
    const matchingAnswer = answers.find(
      (a) => a.dimensionKey.toLowerCase() === dim.key.toLowerCase()
    );
    if (matchingAnswer) {
      const newScore = Math.max(0, Math.min(100, matchingAnswer.score));
      return {
        ...dim,
        score: newScore,
        stage: calculateMaturityStage(newScore),
      };
    }
    return dim;
  });

  const overallScore = Math.round(
    updatedDimensions.reduce((acc, d) => acc + d.score, 0) / updatedDimensions.length
  );
  const overallStage = calculateMaturityStage(overallScore);

  return {
    ...currentSummary,
    overallScore,
    overallStage,
    dimensions: updatedDimensions,
  };
}

