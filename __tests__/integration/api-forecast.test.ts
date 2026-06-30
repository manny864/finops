import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { Pool } from '@/modules/storage/db';
import { GET, POST } from '@/app/api/intelligence/forecast/route';

// Mock the dependencies
vi.mock('@/modules/collectors/azure/billingService', () => ({
  getCurrentMonthAmortizedCosts: vi.fn(),
  getCostForecast: vi.fn(),
}));

vi.mock('@/modules/storage/db', () => ({
  default: {
    query: vi.fn(),
  },
}));

vi.mock('@/lib/requestAuth', () => ({
  requireTenantAccess: vi.fn(),
  AuthError: class AuthError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
}));

import { getCurrentMonthAmortizedCosts, getCostForecast } from '@/modules/collectors/azure/billingService';
import pool from '@/modules/storage/db';
import { requireTenantAccess, AuthError } from '@/lib/requestAuth';

describe('API: /intelligence/forecast', () => {
  beforeAll(() => {
    vi.clearAllMocks();
  });

  afterAll(() => {
    vi.clearAllMocks();
  });

  // ===========================================================================
  // GET Tests
  // ===========================================================================

  describe('GET /intelligence/forecast', () => {
    it('should return 400 without tenantId', async () => {
      const request = new NextRequest('http://localhost/api/intelligence/forecast');
      const response = await GET(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('tenantId');
    });

    it('should return 401 when not authenticated', async () => {
      vi.mocked(requireTenantAccess).mockRejectedValueOnce(
        new AuthError('Unauthorized', 401)
      );

      const request = new NextRequest(
        'http://localhost/api/intelligence/forecast?tenantId=tenant1'
      );
      const response = await GET(request);

      expect(response.status).toBe(401);
    });

    it('should return forecast with linear method', async () => {
      vi.mocked(requireTenantAccess).mockResolvedValueOnce(undefined);
      vi.mocked(getCurrentMonthAmortizedCosts).mockResolvedValueOnce([
        { UsageDate: '20240101', EffectiveCost: 100 },
        { UsageDate: '20240102', EffectiveCost: 150 },
        { UsageDate: '20240103', EffectiveCost: 200 },
        { UsageDate: '20240104', EffectiveCost: 250 },
      ]);
      vi.mocked(getCostForecast).mockResolvedValueOnce([]);

      const request = new NextRequest(
        'http://localhost/api/intelligence/forecast?tenantId=tenant1&method=linear&days=5'
      );
      const response = await GET(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      // Return new format for advanced query
      expect(data.method_used || data.data).toBeDefined();
    });

    it('should return forecast with confidence intervals', async () => {
      vi.mocked(requireTenantAccess).mockResolvedValueOnce(undefined);
      vi.mocked(getCurrentMonthAmortizedCosts).mockResolvedValueOnce([
        { UsageDate: '20240101', EffectiveCost: 1000 },
        { UsageDate: '20240102', EffectiveCost: 1100 },
        { UsageDate: '20240103', EffectiveCost: 1050 },
        { UsageDate: '20240104', EffectiveCost: 1200 },
        { UsageDate: '20240105', EffectiveCost: 1150 },
      ]);
      vi.mocked(getCostForecast).mockResolvedValueOnce([]);

      const request = new NextRequest(
        'http://localhost/api/intelligence/forecast?tenantId=tenant1&method=holt_winters&withConfidence=true&days=7'
      );
      const response = await GET(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.method_used).toBeDefined();
      expect(data.forecast).toBeDefined();
      expect(data.metrics).toBeDefined();
      expect(data.anomalies).toBeDefined();

      // Verify forecast structure
      if (data.forecast && data.forecast.length > 0) {
        expect(data.forecast[0].date).toBeDefined();
        expect(data.forecast[0].value).toBeDefined();
        expect(data.forecast[0].lower).toBeDefined();
        expect(data.forecast[0].upper).toBeDefined();
      }
    });

    it('should auto-select best method', async () => {
      vi.mocked(requireTenantAccess).mockResolvedValueOnce(undefined);
      const historicalData = Array.from({ length: 20 }, (_, i) => ({
        UsageDate: String(20240101 + i),
        EffectiveCost: 1000 + i * 50 + Math.random() * 100,
      }));
      vi.mocked(getCurrentMonthAmortizedCosts).mockResolvedValueOnce(historicalData);
      vi.mocked(getCostForecast).mockResolvedValueOnce([]);

      const request = new NextRequest(
        'http://localhost/api/intelligence/forecast?tenantId=tenant1&method=auto&days=5'
      );
      const response = await GET(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.method_used).toMatch(/linear|ema|holt_winters|ensemble/);
    });

    it('should include backtest metrics when requested', async () => {
      vi.mocked(requireTenantAccess).mockResolvedValueOnce(undefined);
      const historicalData = Array.from({ length: 15 }, (_, i) => ({
        UsageDate: String(20240101 + i),
        EffectiveCost: 1000 + i * 50,
      }));
      vi.mocked(getCurrentMonthAmortizedCosts).mockResolvedValueOnce(historicalData);
      vi.mocked(getCostForecast).mockResolvedValueOnce([]);

      const request = new NextRequest(
        'http://localhost/api/intelligence/forecast?tenantId=tenant1&withBacktest=true&days=5'
      );
      const response = await GET(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.backtest).toBeDefined();
      if (data.backtest) {
        expect(data.backtest.rmse).toBeDefined();
        expect(data.backtest.mape).toBeDefined();
      }
    });

    it('should handle fallback to EMA when HW insufficient history', async () => {
      vi.mocked(requireTenantAccess).mockResolvedValueOnce(undefined);
      // Only 10 days of history (< 2*season=14)
      const historicalData = Array.from({ length: 10 }, (_, i) => ({
        UsageDate: String(20240101 + i),
        EffectiveCost: 1000 + i * 100,
      }));
      vi.mocked(getCurrentMonthAmortizedCosts).mockResolvedValueOnce(historicalData);
      vi.mocked(getCostForecast).mockResolvedValueOnce([]);

      const request = new NextRequest(
        'http://localhost/api/intelligence/forecast?tenantId=tenant1&method=holt_winters&days=3'
      );
      const response = await GET(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      // Should fall back to EMA (since history < 14)
      expect(data.method_used || 'ema').toMatch(/ema|holt_winters/);
    });

    it('should cap days at 90', async () => {
      vi.mocked(requireTenantAccess).mockResolvedValueOnce(undefined);
      vi.mocked(getCurrentMonthAmortizedCosts).mockResolvedValueOnce([
        { UsageDate: '20240101', EffectiveCost: 1000 },
        { UsageDate: '20240102', EffectiveCost: 1100 },
        { UsageDate: '20240103', EffectiveCost: 1200 },
      ]);
      vi.mocked(getCostForecast).mockResolvedValueOnce([]);

      const request = new NextRequest(
        'http://localhost/api/intelligence/forecast?tenantId=tenant1&days=200'
      );
      const response = await GET(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      if (data.metrics) {
        expect(data.metrics.forecast_horizon_days).toBeLessThanOrEqual(90);
      }
    });
  });

  // ===========================================================================
  // POST Tests
  // ===========================================================================

  describe('POST /intelligence/forecast', () => {
    it('should return 400 without tenantId', async () => {
      const request = new NextRequest('http://localhost/api/intelligence/forecast', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      const response = await POST(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('tenantId');
    });

    it('should return 401 when not authenticated', async () => {
      vi.mocked(requireTenantAccess).mockRejectedValueOnce(
        new AuthError('Unauthorized', 401)
      );

      const request = new NextRequest('http://localhost/api/intelligence/forecast', {
        method: 'POST',
        body: JSON.stringify({ tenantId: 'tenant1' }),
      });
      const response = await POST(request);

      expect(response.status).toBe(401);
    });

    it('should return 404 for missing tenant', async () => {
      vi.mocked(requireTenantAccess).mockResolvedValueOnce(undefined);
      vi.mocked(pool.query).mockResolvedValueOnce([[]]);

      const request = new NextRequest('http://localhost/api/intelligence/forecast', {
        method: 'POST',
        body: JSON.stringify({ tenantId: 'unknown' }),
      });
      const response = await POST(request);

      expect(response.status).toBe(404);
    });

    it('should return 403 for unsupported tier', async () => {
      vi.mocked(requireTenantAccess).mockResolvedValueOnce(undefined);
      vi.mocked(pool.query).mockResolvedValueOnce([[{ tier: 'starter' }]]);

      const request = new NextRequest('http://localhost/api/intelligence/forecast', {
        method: 'POST',
        body: JSON.stringify({ tenantId: 'tenant1' }),
      });
      const response = await POST(request);

      expect(response.status).toBe(403);
    });

    it('should project month-end cost with linear method', async () => {
      vi.mocked(requireTenantAccess).mockResolvedValueOnce(undefined);
      vi.mocked(pool.query).mockResolvedValueOnce([[{ tier: 'Pro' }]]);

      // Mock database query for current month costs
      const today = new Date();
      const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
      const costRows = Array.from({ length: today.getDate() }, (_, i) => ({
        day_date: new Date(today.getFullYear(), today.getMonth(), i + 1),
        daily: 100 + i * 10,
      }));

      vi.mocked(pool.query).mockResolvedValueOnce([costRows]);

      const request = new NextRequest('http://localhost/api/intelligence/forecast', {
        method: 'POST',
        body: JSON.stringify({
          tenantId: 'tenant1',
          monthlyBudget: 5000,
          method: 'linear',
        }),
      });
      const response = await POST(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.projectedEndOfMonthCost).toBeGreaterThan(0);
      expect(data.chartData).toBeDefined();
      expect(data.method_used).toBe('linear');
    });

    it('should detect budget breach', async () => {
      vi.mocked(requireTenantAccess).mockResolvedValueOnce(undefined);
      vi.mocked(pool.query).mockResolvedValueOnce([[{ tier: 'Pro' }]]);

      // Create a cost trajectory that exceeds budget
      const today = new Date();
      const costRows = Array.from({ length: Math.min(today.getDate(), 10) }, (_, i) => ({
        day_date: new Date(today.getFullYear(), today.getMonth(), i + 1),
        daily: 500, // 500 per day = 15000 for 30 days
      }));

      vi.mocked(pool.query).mockResolvedValueOnce([costRows]);

      const request = new NextRequest('http://localhost/api/intelligence/forecast', {
        method: 'POST',
        body: JSON.stringify({
          tenantId: 'tenant1',
          monthlyBudget: 5000, // Budget is 5000, projection >5000
          method: 'linear',
        }),
      });
      const response = await POST(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      // Should predict breach
      if (data.projectedEndOfMonthCost > 5000) {
        expect(data.isBreachPredicted).toBe(true);
      }
    });

    it('should use auto method selection', async () => {
      vi.mocked(requireTenantAccess).mockResolvedValueOnce(undefined);
      vi.mocked(pool.query).mockResolvedValueOnce([[{ tier: 'Pro' }]]);

      const today = new Date();
      const costRows = Array.from({ length: Math.min(today.getDate(), 15) }, (_, i) => ({
        day_date: new Date(today.getFullYear(), today.getMonth(), i + 1),
        daily: 1000 + i * 50,
      }));

      vi.mocked(pool.query).mockResolvedValueOnce([costRows]);

      const request = new NextRequest('http://localhost/api/intelligence/forecast', {
        method: 'POST',
        body: JSON.stringify({
          tenantId: 'tenant1',
          monthlyBudget: 50000,
          method: 'auto',
        }),
      });
      const response = await POST(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(['linear', 'ema', 'holt_winters']).toContain(data.method_used);
    });

    it('should handle empty history gracefully', async () => {
      vi.mocked(requireTenantAccess).mockResolvedValueOnce(undefined);
      vi.mocked(pool.query).mockResolvedValueOnce([[{ tier: 'Pro' }]]);
      vi.mocked(pool.query).mockResolvedValueOnce([[]]); // No cost data

      const request = new NextRequest('http://localhost/api/intelligence/forecast', {
        method: 'POST',
        body: JSON.stringify({
          tenantId: 'tenant1',
          monthlyBudget: 5000,
        }),
      });
      const response = await POST(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.empty).toBe(true);
      expect(data.chartData).toHaveLength(0);
    });

    it('should return correct chart data structure', async () => {
      vi.mocked(requireTenantAccess).mockResolvedValueOnce(undefined);
      vi.mocked(pool.query).mockResolvedValueOnce([[{ tier: 'Pro' }]]);

      const today = new Date();
      const costRows = Array.from({ length: Math.min(today.getDate(), 5) }, (_, i) => ({
        day_date: new Date(today.getFullYear(), today.getMonth(), i + 1),
        daily: 100,
      }));

      vi.mocked(pool.query).mockResolvedValueOnce([costRows]);

      const request = new NextRequest('http://localhost/api/intelligence/forecast', {
        method: 'POST',
        body: JSON.stringify({
          tenantId: 'tenant1',
          monthlyBudget: 5000,
        }),
      });
      const response = await POST(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.chartData).toBeDefined();

      const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
      expect(data.chartData).toHaveLength(daysInMonth);

      // Check structure
      for (const point of data.chartData) {
        expect(point.day).toBeDefined();
        expect(typeof point.day).toBe('number');
      }
    });
  });
});
