import { describe, it, expect, vi } from 'vitest';
import { getFinOpsMaturityAssessment, recalculateMaturityWithAssessment } from '@/services/azureMaturity.service';

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
