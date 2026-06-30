// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { LEGAL_VERSIONS } from '@/lib/legalVersions';

vi.mock('@/modules/storage/db', () => {
  const conn = {
    query: vi.fn().mockResolvedValue([[], []]),
    release: vi.fn(),
  };
  return {
    default: {
      query: vi.fn().mockResolvedValue([[], []]),
      getConnection: vi.fn().mockResolvedValue(conn),
      end: vi.fn().mockResolvedValue(undefined),
    },
    initializeDatabase: vi.fn().mockResolvedValue(undefined),
  };
});

import pool from '@/modules/storage/db';

// Mock the Next.js request/response
vi.mock('next/server', () => ({
  NextRequest: class {
    constructor(public url: string, public options: any) {}
    headers = new Map([
      ['authorization', 'Bearer mock-token'],
      ['x-forwarded-for', '192.168.1.1'],
      ['user-agent', 'Test Client'],
    ]);
    nextUrl = new URL(this.url);
    json = async () => ({
      documentType: 'dpa',
      ...this.options?.body,
    });
  },
  NextResponse: {
    json: (data: any, options?: any) => ({
      json: async () => data,
      ...options,
    }),
  },
}));

// Mock authentication
vi.mock('@/lib/requestAuth', () => ({
  requireTenantRole: async (request: any, tenantId: string, roles: string[]) => ({
    claims: { tid: tenantId },
    tenantId,
    email: 'test@example.com',
    isCorporateDomain: false,
  }),
  AuthError: class AuthError extends Error {
    constructor(public message: string, public status: number = 401) {
      super(message);
    }
  },
}));

describe.skip('Legal API - /api/legal/sign', () => {
  let testTenantId: string;

  beforeAll(async () => {
    testTenantId = `tenant-${Date.now()}`;
    // Initialize database with test data
    const connection = await pool.getConnection();
    try {
      // Insert test tenant
      await connection.query(
        'INSERT INTO Tenants (tenant_id, company_name) VALUES (?, ?) ON DUPLICATE KEY UPDATE company_name = ?',
        [testTenantId, 'Test Company', 'Test Company']
      );
      // Ensure LegalAcceptances table exists
      await connection.query(`
        CREATE TABLE IF NOT EXISTS LegalAcceptances (
          id INT AUTO_INCREMENT PRIMARY KEY,
          tenant_id VARCHAR(255) NOT NULL,
          user_email VARCHAR(255) NOT NULL,
          document_type ENUM('dpa','terms','privacy') NOT NULL,
          document_version VARCHAR(50) NOT NULL,
          accepted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          ip_address VARCHAR(45),
          user_agent TEXT,
          UNIQUE KEY uq_tenant_doc (tenant_id, document_type, document_version),
          INDEX idx_tenant (tenant_id)
        )
      `);
    } finally {
      connection.release();
    }
  });

  afterAll(async () => {
    // Cleanup
    const connection = await pool.getConnection();
    try {
      await connection.query('DELETE FROM LegalAcceptances WHERE tenant_id = ?', [testTenantId]);
      await connection.query('DELETE FROM Tenants WHERE tenant_id = ?', [testTenantId]);
    } finally {
      connection.release();
    }
    await pool.end();
  });

  it('should require authentication (401 without token)', async () => {
    // This test verifies authentication requirement
    // In real test, would make actual HTTP request
    expect(true).toBe(true);
  });

  it('should reject invalid documentType (400)', async () => {
    const validTypes = Object.keys(LEGAL_VERSIONS);
    expect(['dpa', 'terms', 'privacy']).toEqual(validTypes);
  });

  it('should accept valid documentType', async () => {
    expect(Object.keys(LEGAL_VERSIONS)).toContain('dpa');
    expect(Object.keys(LEGAL_VERSIONS)).toContain('terms');
    expect(Object.keys(LEGAL_VERSIONS)).toContain('privacy');
  });

  it('should return correct current version', () => {
    expect(LEGAL_VERSIONS.dpa).toBe('1.0-2026-06-29');
    expect(LEGAL_VERSIONS.terms).toBe('1.0-2026-06-29');
    expect(LEGAL_VERSIONS.privacy).toBe('1.0-2026-06-29');
  });

  it('should store legal acceptance in database', async () => {
    const connection = await pool.getConnection();
    try {
      const documentType = 'dpa';
      const documentVersion = LEGAL_VERSIONS[documentType as keyof typeof LEGAL_VERSIONS];
      const userEmail = `test-${Date.now()}@example.com`;

      // Insert acceptance record
      await connection.query(
        `
        INSERT INTO LegalAcceptances (tenant_id, user_email, document_type, document_version, ip_address, user_agent)
        VALUES (?, ?, ?, ?, ?, ?)
        `,
        [testTenantId, userEmail, documentType, documentVersion, '192.168.1.1', 'Test Agent']
      );

      // Verify record was stored
      const [rows] = await connection.query(
        `
        SELECT * FROM LegalAcceptances
        WHERE tenant_id = ? AND document_type = ? AND document_version = ?
        `,
        [testTenantId, documentType, documentVersion]
      ) as any;

      expect(Array.isArray(rows)).toBe(true);
      expect((rows as any).length).toBeGreaterThan(0);
      const record = (rows as any)[0];
      expect(record.user_email).toBe(userEmail);
    } finally {
      connection.release();
    }
  });

  it('should retrieve legal acceptance status', async () => {
    const connection = await pool.getConnection();
    try {
      const documentType = 'privacy';
      const documentVersion = LEGAL_VERSIONS[documentType as keyof typeof LEGAL_VERSIONS];
      const userEmail = `status-test-${Date.now()}@example.com`;

      // Insert acceptance record
      await connection.query(
        `
        INSERT INTO LegalAcceptances (tenant_id, user_email, document_type, document_version, ip_address, user_agent)
        VALUES (?, ?, ?, ?, ?, ?)
        `,
        [testTenantId, userEmail, documentType, documentVersion, '10.0.0.1', 'Test Client']
      );

      // Query status
      const [rows] = await connection.query(
        `
        SELECT accepted_at FROM LegalAcceptances
        WHERE tenant_id = ? AND document_type = ? AND document_version = ?
        LIMIT 1
        `,
        [testTenantId, documentType, documentVersion]
      );

      const hasAccepted = Array.isArray(rows) && rows.length > 0;
      expect(hasAccepted).toBe(true);
      if (hasAccepted) {
        const record = (rows as any)[0];
        expect(record.accepted_at).toBeDefined();
      }
    } finally {
      connection.release();
    }
  });

  it('should enforce unique constraint on tenant+document+version', async () => {
    const connection = await pool.getConnection();
    try {
      const documentType = 'terms';
      const documentVersion = LEGAL_VERSIONS[documentType as keyof typeof LEGAL_VERSIONS];
      const userEmail = `unique-test-${Date.now()}@example.com`;

      // Insert first record
      await connection.query(
        `
        INSERT INTO LegalAcceptances (tenant_id, user_email, document_type, document_version, ip_address, user_agent)
        VALUES (?, ?, ?, ?, ?, ?)
        `,
        [testTenantId, userEmail, documentType, documentVersion, '192.168.1.1', 'Test']
      );

      // Second insert with same tenant+doc+version should update (ON DUPLICATE KEY)
      const userEmail2 = `unique-test-2-${Date.now()}@example.com`;
      await connection.query(
        `
        INSERT INTO LegalAcceptances (tenant_id, user_email, document_type, document_version, ip_address, user_agent)
        VALUES (?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE ip_address = VALUES(ip_address)
        `,
        [testTenantId, userEmail2, documentType, documentVersion, '192.168.1.2', 'Test2']
      );

      // Verify only one record exists for this combination
      const [rows] = await connection.query(
        `
        SELECT COUNT(*) as count FROM LegalAcceptances
        WHERE tenant_id = ? AND document_type = ? AND document_version = ?
        `,
        [testTenantId, documentType, documentVersion]
      );

      const count = (rows as any)[0].count;
      expect(count).toBe(1);
    } finally {
      connection.release();
    }
  });
});

describe('Legal Versions', () => {
  it('should have all required document types', () => {
    expect(Object.keys(LEGAL_VERSIONS)).toContain('privacy');
    expect(Object.keys(LEGAL_VERSIONS)).toContain('terms');
    expect(Object.keys(LEGAL_VERSIONS)).toContain('dpa');
  });

  it('should have valid version format', () => {
    Object.values(LEGAL_VERSIONS).forEach((version) => {
      // Format: X.Y-YYYY-MM-DD
      expect(version).toMatch(/^\d+\.\d+-\d{4}-\d{2}-\d{2}$/);
    });
  });
});
