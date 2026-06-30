// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

// Mock modules first
vi.mock('@/lib/requestAuth', () => ({
  requireTenantAccess: vi.fn(async () => ({
    email: 'test@example.com',
    tenantId: 'test-tenant',
  })),
  AuthError: class AuthError extends Error {
    status = 401;
  },
}));

vi.mock('@/modules/storage/db', () => ({
  default: {
    getConnection: vi.fn(),
  },
  initializeDatabase: vi.fn(async () => {}),
}));

// Import after mocking
import { GET, PUT } from '@/app/api/onboarding/progress/route';
import { POST as POST_FINISH } from '@/app/api/onboarding/finish/route';
import pool from '@/modules/storage/db';
import { requireTenantAccess } from '@/lib/requestAuth';

describe('GET /api/onboarding/progress', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return default progress for new tenant', async () => {
    const mockConnection = {
      query: vi.fn(async () => [[], []]),
      release: vi.fn(),
    };

    (pool.getConnection as any).mockResolvedValueOnce(mockConnection);

    const request = new NextRequest('http://localhost/api/onboarding/progress');
    const response = await GET(request);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.step_welcome).toBe('pending');
    expect(json.step_azure_sp).toBe('pending');
    expect(json.step_first_sync).toBe('pending');
    expect(json.step_first_budget).toBe('pending');
    expect(json.step_notifications).toBe('pending');
    expect(json.percent_complete).toBe(0);
  });

  it('should return existing progress for tenant', async () => {
    const mockProgress = {
      id: 1,
      tenant_id: 'test-tenant',
      step_welcome: 'completed',
      step_azure_sp: 'completed',
      step_first_sync: 'pending',
      step_first_budget: 'pending',
      step_notifications: 'pending',
    };

    const mockConnection = {
      query: vi.fn(async () => [[mockProgress], []]),
      release: vi.fn(),
    };

    (pool.getConnection as any).mockResolvedValueOnce(mockConnection);

    const request = new NextRequest('http://localhost/api/onboarding/progress');
    const response = await GET(request);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.step_welcome).toBe('completed');
    expect(json.step_azure_sp).toBe('completed');
    expect(json.percent_complete).toBe(40);
  });

  it('should return 401 without auth', async () => {
    (requireTenantAccess as any).mockRejectedValueOnce(
      Object.assign(new Error('Unauthorized'), { name: 'AuthError', status: 401 })
    );

    const request = new NextRequest('http://localhost/api/onboarding/progress');
    const response = await GET(request);

    expect(response.status).toBe(401);
  });
});

describe('PUT /api/onboarding/progress', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return 400 for invalid step name', async () => {
    const request = new NextRequest('http://localhost/api/onboarding/progress', {
      method: 'PUT',
      body: JSON.stringify({ step: 'invalid_step', status: 'completed' }),
    });

    const response = await PUT(request);
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error).toContain('Invalid step name');
  });

  it('should return 400 for invalid status', async () => {
    const request = new NextRequest('http://localhost/api/onboarding/progress', {
      method: 'PUT',
      body: JSON.stringify({ step: 'step_welcome', status: 'invalid_status' }),
    });

    const response = await PUT(request);
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error).toContain('Invalid status');
  });

  it('should update step status successfully', async () => {
    const mockConnection = {
      query: vi.fn(async (sql) => {
        if (sql.includes('INSERT IGNORE')) return [[], []];
        if (sql.includes('UPDATE')) return [[], []];
        return [[
          {
            step_welcome: 'completed',
            step_azure_sp: 'pending',
            step_first_sync: 'pending',
            step_first_budget: 'pending',
            step_notifications: 'pending',
          },
        ], []];
      }),
      release: vi.fn(),
    };

    (pool.getConnection as any).mockResolvedValueOnce(mockConnection);

    const request = new NextRequest('http://localhost/api/onboarding/progress', {
      method: 'PUT',
      body: JSON.stringify({ step: 'step_welcome', status: 'completed' }),
    });

    const response = await PUT(request);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.step_welcome).toBe('completed');
  });

  it('should handle all valid step names', async () => {
    const mockConnection = {
      query: vi.fn(async (sql) => {
        if (sql.includes('INSERT IGNORE')) return [[], []];
        if (sql.includes('UPDATE')) return [[], []];
        return [[{
          step_welcome: 'pending',
          step_azure_sp: 'pending',
          step_first_sync: 'pending',
          step_first_budget: 'pending',
          step_notifications: 'pending',
        }], []];
      }),
      release: vi.fn(),
    };

    const validSteps = [
      'step_welcome',
      'step_azure_sp',
      'step_first_sync',
      'step_first_budget',
      'step_notifications',
    ];

    for (const step of validSteps) {
      (pool.getConnection as any).mockResolvedValueOnce(mockConnection);

      const request = new NextRequest('http://localhost/api/onboarding/progress', {
        method: 'PUT',
        body: JSON.stringify({ step, status: 'completed' }),
      });

      const response = await PUT(request);

      expect(response.status).toBe(200);
    }
  });
});

describe('POST /api/onboarding/finish', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return 401 without auth', async () => {
    (requireTenantAccess as any).mockRejectedValueOnce(
      Object.assign(new Error('Unauthorized'), { name: 'AuthError', status: 401 })
    );

    const request = new NextRequest('http://localhost/api/onboarding/finish', {
      method: 'POST',
    });

    const response = await POST_FINISH(request);

    expect(response.status).toBe(401);
  });

  it('should mark all steps as completed and set is_onboarded=1', async () => {
    const mockConnection = {
      query: vi.fn(async () => [[], []]),
      beginTransaction: vi.fn(async () => {}),
      commit: vi.fn(async () => {}),
      rollback: vi.fn(async () => {}),
      release: vi.fn(),
    };

    (pool.getConnection as any).mockResolvedValueOnce(mockConnection);

    const request = new NextRequest('http://localhost/api/onboarding/finish', {
      method: 'POST',
    });

    const response = await POST_FINISH(request);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    expect(mockConnection.beginTransaction).toHaveBeenCalled();
    expect(mockConnection.commit).toHaveBeenCalled();
    expect(mockConnection.query).toHaveBeenCalledTimes(3);
  });

  it('should rollback on database error', async () => {
    const mockConnection = {
      query: vi.fn(async (sql) => {
        if (sql.includes('INSERT INTO OnboardingProgress')) {
          throw new Error('Database error');
        }
        return [[], []];
      }),
      beginTransaction: vi.fn(async () => {}),
      commit: vi.fn(async () => {}),
      rollback: vi.fn(async () => {}),
      release: vi.fn(),
    };

    (pool.getConnection as any).mockResolvedValueOnce(mockConnection);

    const request = new NextRequest('http://localhost/api/onboarding/finish', {
      method: 'POST',
    });

    const response = await POST_FINISH(request);

    expect(response.status).toBe(500);
    expect(mockConnection.rollback).toHaveBeenCalled();
  });
});
