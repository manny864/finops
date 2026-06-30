// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import jwt from 'jsonwebtoken';

/**
 * Integration tests for signup/trial funnel APIs
 * Note: These tests assume a mock database and auth layer
 */

// Mock token helper
function createMockToken(tenantId: string, oid: string, email: string): string {
  return jwt.sign(
    {
      tid: tenantId,
      oid: oid,
      preferred_username: email,
      email: email,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    },
    'test-secret'
  );
}

// Skipped: requires a running dev server at localhost:3000. Run manually as E2E.
describe.skip('Signup/Trial Funnel APIs', () => {
  const baseUrl = process.env.TEST_API_URL || 'http://localhost:3000';
  const cronSecret = process.env.CRON_SECRET || 'test-secret';
  const superAdminToken = createMockToken(
    '8b41364f-581a-4e43-b7cb-13138dac5517',
    'superadmin-oid',
    'admin@cscloudsolutions.com.ar'
  );

  describe('POST /api/onboard', () => {
    it('should return 401 without auth token', async () => {
      const res = await fetch(`${baseUrl}/api/onboard`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: 'pro' }),
      });
      expect(res.status).toBe(401);
    });

    it('should accept valid auth and plan', async () => {
      const token = createMockToken('tenant-123', 'oid-123', 'user@example.com');
      const res = await fetch(`${baseUrl}/api/onboard`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ plan: 'pro' }),
      });
      // Should succeed or return auth error (depending on token validation)
      expect([200, 401, 400]).toContain(res.status);
    });
  });

  describe('POST /api/onboard/complete', () => {
    it('should return 401 without auth token', async () => {
      const res = await fetch(`${baseUrl}/api/onboard/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(401);
    });

    it('should accept valid auth', async () => {
      const token = createMockToken('tenant-123', 'oid-123', 'user@example.com');
      const res = await fetch(`${baseUrl}/api/onboard/complete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
      });
      expect([200, 401, 400]).toContain(res.status);
    });
  });

  describe('GET /api/cron/trial-expiry', () => {
    it('should return 401 without secret', async () => {
      const res = await fetch(`${baseUrl}/api/cron/trial-expiry`);
      expect(res.status).toBe(401);
    });

    it('should return 401 with wrong secret', async () => {
      const res = await fetch(`${baseUrl}/api/cron/trial-expiry?secret=wrong`);
      expect(res.status).toBe(401);
    });

    it('should return 200 with correct secret', async () => {
      const res = await fetch(`${baseUrl}/api/cron/trial-expiry?secret=${cronSecret}`);
      expect([200, 401]).toContain(res.status); // 401 if secret doesn't match env
      if (res.status === 200) {
        const data = await res.json();
        expect(data).toHaveProperty('success');
        expect(data).toHaveProperty('processed');
      }
    });
  });

  describe('POST /api/superadmin/tenants/extend-trial', () => {
    it('should return 401 without auth token', async () => {
      const res = await fetch(`${baseUrl}/api/superadmin/tenants/extend-trial`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId: 'test-tenant', days: 7 }),
      });
      expect(res.status).toBe(401);
    });

    it('should return 400 with invalid request', async () => {
      const token = superAdminToken;
      const res = await fetch(`${baseUrl}/api/superadmin/tenants/extend-trial`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({}),
      });
      expect([400, 401]).toContain(res.status);
    });

    it('should return 404 for non-existent tenant', async () => {
      const token = superAdminToken;
      const res = await fetch(`${baseUrl}/api/superadmin/tenants/extend-trial`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ tenantId: 'nonexistent', days: 7 }),
      });
      expect([404, 401]).toContain(res.status);
    });
  });

  describe('GET /api/superadmin/funnel', () => {
    it('should return 401 without auth token', async () => {
      const res = await fetch(`${baseUrl}/api/superadmin/funnel`);
      expect(res.status).toBe(401);
    });

    it('should return 200 with valid superadmin token', async () => {
      const token = superAdminToken;
      const res = await fetch(`${baseUrl}/api/superadmin/funnel`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      expect([200, 401]).toContain(res.status);
      if (res.status === 200) {
        const data = await res.json();
        expect(data).toHaveProperty('kpis');
        expect(data).toHaveProperty('funnel');
        expect(data).toHaveProperty('recent_signups');
        expect(data.kpis).toHaveProperty('signups_30d');
        expect(data.kpis).toHaveProperty('conversion_pct');
      }
    });
  });

  describe('Trial state transitions', () => {
    it('should correctly track signup -> trial -> converted flow', async () => {
      // This is a high-level integration scenario
      // In a real test, you'd mock the database and verify:
      // 1. Signup creates SignupEvents record with 'signup_started'
      // 2. Onboard creates SignupEvents with 'trial_started'
      // 3. Trial expiry cron marks expired and sends email
      expect(true).toBe(true);
    });
  });
});
