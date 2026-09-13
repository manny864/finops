import { describe, it, expect, vi } from 'vitest';
import { getFinOpsMaturityAssessment, recalculateMaturityWithAssessment, applySelfAssessment } from '@/services/azureMaturity.service';
import { calculateMaturityStage } from '@/lib/finopsMaturityConstants';
import type { MaturityDimension } from '@/types/finopsMaturity.types';

describe('azureMaturity.service', () => {
  it('should return mock maturity summary for demo tenant', async () => {
    const res = await getFinOpsMaturityAssessment('demo-tenant-123');
    expect(res).toBeDefined();
    expect(res.overallScore).toBeGreaterThanOrEqual(0);
    expect(res.overallScore).toBeLessThanOrEqual(100);
    expect(['CRAWL', 'WALK', 'RUN']).toContain(res.overallStage);
    expect(res.dimensions.length).toBe(6);
    expect(res.nextMilestones.length).toBeGreaterThan(0);
  });

  it('should recalculate scores with assessment answers', () => {
    const baseline = {
      overallScore: 30,
      overallStage: 'CRAWL' as const,
      dimensions: [
        { key: 'visibility', name: 'Visibilidad e Información', score: 30, stage: 'CRAWL' as const, recommendationsCount: 3, actionPlan: 'P1' },
        { key: 'rate_opt', name: 'Optimización de Tasa', score: 30, stage: 'CRAWL' as const, recommendationsCount: 2, actionPlan: 'P2' },
        { key: 'usage_opt', name: 'Optimización de Uso', score: 30, stage: 'CRAWL' as const, recommendationsCount: 2, actionPlan: 'P3' },
        { key: 'governance', name: 'Gobernanza de Nube', score: 30, stage: 'CRAWL' as const, recommendationsCount: 2, actionPlan: 'P4' },
        { key: 'automation', name: 'Automatización & CI/CD', score: 30, stage: 'CRAWL' as const, recommendationsCount: 1, actionPlan: 'P5' },
        { key: 'culture', name: 'Cultura & Habilitación', score: 30, stage: 'CRAWL' as const, recommendationsCount: 1, actionPlan: 'P6' },
      ],
      nextMilestones: [],
    };

    const updated = recalculateMaturityWithAssessment(baseline, [
      { questionId: 'q_vis', dimensionKey: 'visibility', score: 90 },
      { questionId: 'q_gov', dimensionKey: 'governance', score: 85 },
    ]);

    expect(updated.dimensions.find(d => d.key === 'visibility')?.score).toBe(90);
    expect(updated.dimensions.find(d => d.key === 'visibility')?.stage).toBe('RUN');
    expect(updated.dimensions.find(d => d.key === 'governance')?.score).toBe(85);
    expect(updated.overallScore).toBeGreaterThan(30);
  });
});

describe('applySelfAssessment — ponderación por tenant (MEJ-08)', () => {
  // visibility: el equipo se declara maduro y la telemetría no acompaña (+50).
  // culture: la telemetría va por delante de lo que el equipo declara (-30).
  const dims: MaturityDimension[] = [
    { key: 'visibility', name: 'V', score: 40, stage: 'CRAWL', recommendationsCount: 0, actionPlan: 'P' },
    { key: 'culture', name: 'C', score: 80, stage: 'RUN', recommendationsCount: 0, actionPlan: 'P' },
    { key: 'automation', name: 'A', score: 55, stage: 'WALK', recommendationsCount: 0, actionPlan: 'P' },
  ];
  const declarado = { visibility: 90, culture: 50 };
  const porClave = (r: MaturityDimension[], k: string) => r.find((d) => d.key === k)!;

  it('sin política explícita se comporta como antes: manda el equipo', () => {
    const r = applySelfAssessment(dims, declarado);
    expect(porClave(r, 'visibility').score).toBe(90);
    expect(porClave(r, 'culture').score).toBe(50);
    expect(porClave(r, 'visibility').scoreSource).toBe('self_assessment');
  });

  it("'telemetry' hace mandar a la evidencia medida", () => {
    const r = applySelfAssessment(dims, declarado, 'telemetry');
    expect(porClave(r, 'visibility').score).toBe(40);
    expect(porClave(r, 'culture').score).toBe(80);
    expect(porClave(r, 'visibility').scoreSource).toBe('telemetry');
  });

  it("'blended_50_50' promedia las dos", () => {
    const r = applySelfAssessment(dims, declarado, 'blended_50_50');
    expect(porClave(r, 'visibility').score).toBe(65);
    expect(porClave(r, 'culture').score).toBe(65);
    expect(porClave(r, 'visibility').scoreSource).toBe('blended');
  });

  it('la telemetría original queda siempre accesible, gane quien gane', () => {
    for (const pol of ['self_assessment', 'telemetry', 'blended_50_50'] as const) {
      const r = applySelfAssessment(dims, declarado, pol);
      expect(porClave(r, 'visibility').telemetryScore, pol).toBe(40);
      expect(porClave(r, 'culture').telemetryScore, pol).toBe(80);
    }
  });

  it('la divergencia se anota con CUALQUIER política', () => {
    // Es la conversación FinOps útil: que las dos lecturas no coincidan no
    // depende de cuál gane. Perderla al cambiar de política vaciaría el plan
    // de acción justo para el cliente auditado, que es el que más lo mira.
    for (const pol of ['self_assessment', 'telemetry', 'blended_50_50'] as const) {
      const r = applySelfAssessment(dims, declarado, pol);
      expect(porClave(r, 'visibility').divergenceKey, pol).toBe('plan.divergeOptimistic');
      expect(porClave(r, 'culture').divergenceKey, pol).toBe('plan.divergeConservative');
    }
  });

  it('el stage sigue al score efectivo, no al declarado', () => {
    const r = applySelfAssessment(dims, declarado, 'telemetry');
    expect(porClave(r, 'visibility').stage).toBe(calculateMaturityStage(40));
    expect(porClave(r, 'culture').stage).toBe(calculateMaturityStage(80));
  });

  it('una dimensión sin respuesta del equipo no se toca con ninguna política', () => {
    for (const pol of ['self_assessment', 'telemetry', 'blended_50_50'] as const) {
      const r = applySelfAssessment(dims, declarado, pol);
      expect(porClave(r, 'automation'), pol).toEqual(porClave(dims, 'automation'));
    }
  });

  it('sin autoevaluación devuelve las dimensiones intactas', () => {
    expect(applySelfAssessment(dims, {}, 'telemetry')).toEqual(dims);
  });
});
