// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

// Mock dependencies first before importing the route handlers
vi.mock('@/modules/storage/db', () => {
    const mockPool = {
        query: vi.fn(),
        getConnection: vi.fn(),
    };
    return { default: mockPool };
});

vi.mock('@/lib/requestAuth', () => ({
    AuthError: class AuthError extends Error {
        status: number;
        constructor(message: string, status = 401) {
            super(message);
            this.status = status;
        }
    },
    requireTenantAccess: vi.fn().mockResolvedValue({
        email: 'user@example.com',
        tenantId: 'test-tenant',
        claims: { oid: 'user-oid' },
    }),
    requireTenantRole: vi.fn().mockResolvedValue({
        email: 'user@example.com',
        tenantId: 'test-tenant',
        claims: { oid: 'user-oid' },
    }),
    requireSuperAdmin: vi.fn().mockResolvedValue({
        email: 'admin@corp.com',
        isCorporateDomain: true,
    }),
}));

// NOW import the route handlers
import { GET, PUT } from '@/app/api/admin/data-residency/route';

describe('Data Residency API', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('GET /api/admin/data-residency', () => {
        it('should return 400 if tenantId is missing', async () => {
            const request = new NextRequest(
                new URL('http://localhost:3000/api/admin/data-residency'),
                { headers: { authorization: 'Bearer token' } }
            );

            const response = await GET(request);
            expect(response.status).toBe(400);
        });

        it('should return current region for valid tenant', async () => {
            const { default: mockPool } = await import('@/modules/storage/db');
            mockPool.query.mockResolvedValueOnce([
                [{ data_residency: 'EU', data_residency_locked_at: null }]
            ]);

            const request = new NextRequest(
                new URL('http://localhost:3000/api/admin/data-residency?tenantId=test-tenant'),
                { headers: { authorization: 'Bearer token' } }
            );

            const response = await GET(request);
            expect(response.status).toBe(200);
            const data = await response.json();
            expect(data.region).toBe('EU');
            expect(data.can_change).toBe(true);
            expect(data.available_regions).toContain('EU');
        });

        it('should indicate locked state', async () => {
            const { default: mockPool } = await import('@/modules/storage/db');
            mockPool.query.mockResolvedValueOnce([
                [{ 
                    data_residency: 'EU', 
                    data_residency_locked_at: new Date('2025-01-01').toISOString() 
                }]
            ]);

            const request = new NextRequest(
                new URL('http://localhost:3000/api/admin/data-residency?tenantId=test-tenant'),
                { headers: { authorization: 'Bearer token' } }
            );

            const response = await GET(request);
            expect(response.status).toBe(200);
            const data = await response.json();
            expect(data.can_change).toBe(false);
            expect(data.locked_at).toBeDefined();
        });

        it('should return 404 if tenant not found', async () => {
            const { default: mockPool } = await import('@/modules/storage/db');
            mockPool.query.mockResolvedValueOnce([[]]);

            const request = new NextRequest(
                new URL('http://localhost:3000/api/admin/data-residency?tenantId=nonexistent'),
                { headers: { authorization: 'Bearer token' } }
            );

            const response = await GET(request);
            expect(response.status).toBe(404);
        });
    });

    describe('PUT /api/admin/data-residency', () => {
        it('should return 400 if region is invalid', async () => {
            const request = new NextRequest(
                new URL('http://localhost:3000/api/admin/data-residency'),
                {
                    method: 'PUT',
                    headers: { 
                        authorization: 'Bearer token',
                        'content-type': 'application/json'
                    },
                    body: JSON.stringify({
                        tenantId: 'test-tenant',
                        region: 'INVALID'
                    })
                }
            );

            const response = await PUT(request);
            expect(response.status).toBe(400);
            const data = await response.json();
            expect(data.error).toContain('Invalid region');
        });

        it('should return 423 if region is locked', async () => {
            const { default: mockPool } = await import('@/modules/storage/db');
            const mockConnection = {
                query: vi.fn(),
                beginTransaction: vi.fn(),
                rollback: vi.fn(),
                release: vi.fn(),
            };

            mockPool.getConnection.mockResolvedValueOnce(mockConnection);
            mockConnection.query
                .mockResolvedValueOnce([[{ 
                    data_residency: 'EU', 
                    data_residency_locked_at: new Date().toISOString() 
                }]]);

            const request = new NextRequest(
                new URL('http://localhost:3000/api/admin/data-residency'),
                {
                    method: 'PUT',
                    headers: { 
                        authorization: 'Bearer token',
                        'content-type': 'application/json'
                    },
                    body: JSON.stringify({
                        tenantId: 'test-tenant',
                        region: 'US'
                    })
                }
            );

            const response = await PUT(request);
            expect(response.status).toBe(423);
        });

        it('should update region and create audit log', async () => {
            const { default: mockPool } = await import('@/modules/storage/db');
            const mockConnection = {
                query: vi.fn(),
                beginTransaction: vi.fn(),
                commit: vi.fn(),
                rollback: vi.fn(),
                release: vi.fn(),
            };

            mockPool.getConnection.mockResolvedValueOnce(mockConnection);
            mockConnection.query
                .mockResolvedValueOnce([[{ data_residency: 'US', data_residency_locked_at: null }]])
                .mockResolvedValueOnce(undefined) // UPDATE Tenants
                .mockResolvedValueOnce(undefined) // INSERT DataResidencyChanges
                .mockResolvedValueOnce(undefined); // INSERT ActionLogs

            const request = new NextRequest(
                new URL('http://localhost:3000/api/admin/data-residency'),
                {
                    method: 'PUT',
                    headers: { 
                        authorization: 'Bearer token',
                        'content-type': 'application/json'
                    },
                    body: JSON.stringify({
                        tenantId: 'test-tenant',
                        region: 'EU',
                        reason: 'GDPR compliance'
                    })
                }
            );

            const response = await PUT(request);
            expect(response.status).toBe(200);
            const data = await response.json();
            expect(data.success).toBe(true);
            expect(mockConnection.commit).toHaveBeenCalled();
        });

        it('should lock region when lock query param is true', async () => {
            const { default: mockPool } = await import('@/modules/storage/db');
            const mockConnection = {
                query: vi.fn(),
                beginTransaction: vi.fn(),
                commit: vi.fn(),
                rollback: vi.fn(),
                release: vi.fn(),
            };

            mockPool.getConnection.mockResolvedValueOnce(mockConnection);
            mockConnection.query
                .mockResolvedValueOnce([[{ data_residency: 'US', data_residency_locked_at: null }]])
                .mockResolvedValueOnce(undefined) // UPDATE Tenants
                .mockResolvedValueOnce(undefined) // INSERT DataResidencyChanges
                .mockResolvedValueOnce(undefined) // INSERT ActionLogs
                .mockResolvedValueOnce(undefined); // UPDATE lock

            const request = new NextRequest(
                new URL('http://localhost:3000/api/admin/data-residency?lock=true'),
                {
                    method: 'PUT',
                    headers: { 
                        authorization: 'Bearer token',
                        'content-type': 'application/json'
                    },
                    body: JSON.stringify({
                        tenantId: 'test-tenant',
                        region: 'EU'
                    })
                }
            );

            const response = await PUT(request);
            expect(response.status).toBe(200);
            const data = await response.json();
            expect(data.locked).toBe(true);
        });
    });
});
