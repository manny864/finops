import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/intelligence/kpis/coin/route';

vi.mock('@/lib/requestAuth', () => ({
    requireTenantAccess: vi.fn().mockResolvedValue({ email: 'admin@finops.corp', role: 'Owner' }),
    requireTenantTier: vi.fn().mockResolvedValue(true),
    AuthError: class AuthError extends Error {
        status: number;
        constructor(message: string, status = 403) {
            super(message);
            this.status = status;
        }
    },
}));

describe('GET /api/intelligence/kpis/coin', () => {
    it('returns 400 if tenantId is missing', async () => {
        const req = new NextRequest('http://localhost:3000/api/intelligence/kpis/coin');
        const res = await GET(req);
        expect(res.status).toBe(400);
        const json = await res.json();
        expect(json.error).toBe('Falta tenantId');
    });

    it('returns 200 with complete summary for mock tenant', async () => {
        const req = new NextRequest('http://localhost:3000/api/intelligence/kpis/coin?tenantId=demo-tenant&days=90');
        const res = await GET(req);
        expect(res.status).toBe(200);
        const json = await res.json();

        expect(json.success).toBe(true);
        expect(json.coinVolumeRate).toBe(0);
        expect(json.coinFinancialRate).toBe(0);
        expect(json.statusBreakdown.pending).toBe(75);
        expect(json.statusBreakdown.total).toBe(75);
        expect(json.breakdown).toHaveLength(5);
        expect(json.monthly).toHaveLength(6);
        expect(json.quickWins.length).toBeGreaterThan(0);
    });
});
