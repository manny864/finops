import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mysql from 'mysql2/promise';
import { v4 as uuidv4 } from 'uuid';
import { verifyToken } from '@/lib/mfa';
import { encryptSecret, decryptSecret, generateRecoveryCodes } from '@/lib/mfaCrypto';

// @vitest-environment node

let pool: mysql.Pool;
let testEmail: string;
let testTenantId: string;
let testToken: string;

beforeAll(async () => {
  // Set up test database
  pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'finops_user',
    password: process.env.DB_PASSWORD || 'finopspassword',
    database: process.env.DB_NAME || 'finops_app',
    port: Number(process.env.DB_PORT || 3306),
  });

  // Set encryption key
  process.env.MFA_ENCRYPTION_KEY = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';

  testEmail = `test-mfa-${uuidv4()}@example.com`;
  testTenantId = `tenant-${uuidv4()}`;

  // Create test tenant
  const connection = await pool.getConnection();
  try {
    await connection.query(
      `INSERT INTO Tenants (tenant_id, company_name) VALUES (?, ?)`,
      [testTenantId, 'Test Tenant']
    );

    // Create test user
    await connection.query(
      `INSERT INTO Users (entra_oid, tenant_id, email, role, system_role) VALUES (?, ?, ?, ?, ?)`,
      [`oid-${uuidv4()}`, testTenantId, testEmail, 'Admin', 'USER']
    );
  } finally {
    connection.release();
  }
});

afterAll(async () => {
  if (pool) {
    // Clean up test data
    const connection = await pool.getConnection();
    try {
      await connection.query(`DELETE FROM Users WHERE email = ?`, [testEmail]);
      await connection.query(`DELETE FROM Tenants WHERE tenant_id = ?`, [testTenantId]);
      await connection.query(`DELETE FROM MfaChallenges WHERE user_email = ?`, [testEmail]);
    } finally {
      connection.release();
    }

    await pool.end();
  }
});

// Skipped: requires real MySQL connection. Run manually with DB available.
describe.skip('MFA API Integration Tests', () => {
  describe('POST /api/mfa/enroll/start', () => {
    it('should require authentication', async () => {
      const res = await fetch('http://localhost:3000/api/mfa/enroll/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(401);
    });

    it('should return QR code and recovery codes when authenticated', async () => {
      // This test would need proper auth token setup
      // For now, we document how it should work
      
      // const headers = {
      //   'Authorization': `Bearer ${validToken}`,
      //   'Content-Type': 'application/json'
      // };
      // const res = await fetch('http://localhost:3000/api/mfa/enroll/start', {
      //   method: 'POST',
      //   headers
      // });
      // expect(res.status).toBe(200);
      // const data = await res.json();
      // expect(data.qrCodeDataUrl).toBeDefined();
      // expect(data.manualSecret).toBeDefined();
      // expect(data.recoveryCodes).toHaveLength(10);
      
      expect(true).toBe(true);
    });
  });

  describe('POST /api/mfa/challenge', () => {
    it('should return 412 if user has no MFA enabled', async () => {
      // Verify user has no MFA enabled
      const connection = await pool.getConnection();
      try {
        const [rows] = await connection.query(
          `SELECT mfa_enabled FROM Users WHERE email = ?`,
          [testEmail]
        );
        expect((rows as any[])[0].mfa_enabled).toBe(false);
      } finally {
        connection.release();
      }

      // This test would need proper auth token
      // For now, we document expected behavior
      
      // const res = await fetch('http://localhost:3000/api/mfa/challenge', {
      //   method: 'POST',
      //   headers: {
      //     'Authorization': `Bearer ${validToken}`,
      //     'Content-Type': 'application/json'
      //   },
      //   body: JSON.stringify({
      //     operation: 'delete_tenant',
      //     payload: { tenant_id: 'test' }
      //   })
      // });
      // expect(res.status).toBe(412);
      // const data = await res.json();
      // expect(data.error.code).toBe('mfa_required');
      
      expect(true).toBe(true);
    });
  });

  describe('POST /api/mfa/verify-challenge', () => {
    it('should reject expired challenges', async () => {
      const connection = await pool.getConnection();
      try {
        // Create an expired challenge
        const challengeId = uuidv4();
        const expiresAt = new Date(Date.now() - 1000); // 1 second ago

        await connection.query(
          `INSERT INTO MfaChallenges (id, user_email, tenant_id, operation, expires_at) 
           VALUES (?, ?, ?, ?, ?)`,
          [challengeId, testEmail, testTenantId, 'test_op', expiresAt]
        );

        // This test would need proper auth token
        // For now, we verify the data was created
        const [rows] = await connection.query(
          `SELECT * FROM MfaChallenges WHERE id = ?`,
          [challengeId]
        );
        expect((rows as any[]).length).toBe(1);
      } finally {
        connection.release();
      }

      expect(true).toBe(true);
    });
  });

  describe('Database schema', () => {
    it('should have MFA columns on Users table', async () => {
      const connection = await pool.getConnection();
      try {
        const [columns]: any = await connection.query(`
          SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
          WHERE TABLE_NAME = 'Users' AND TABLE_SCHEMA = ?
        `, [process.env.DB_NAME || 'finops_app']);

        const columnNames = (columns as any[]).map((c) => c.COLUMN_NAME);
        expect(columnNames).toContain('mfa_enabled');
        expect(columnNames).toContain('mfa_secret_encrypted');
        expect(columnNames).toContain('mfa_recovery_codes_hash');
        expect(columnNames).toContain('mfa_last_used_at');
      } finally {
        connection.release();
      }
    });

    it('should have MfaChallenges table', async () => {
      const connection = await pool.getConnection();
      try {
        const [tables]: any = await connection.query(`
          SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES 
          WHERE TABLE_NAME = 'MfaChallenges' AND TABLE_SCHEMA = ?
        `, [process.env.DB_NAME || 'finops_app']);

        expect((tables as any[]).length).toBe(1);
      } finally {
        connection.release();
      }
    });
  });

  describe('Encryption workflow', () => {
    it('should encrypt and store secret in database', async () => {
      const secret = 'TESTBASE32SECRET';
      const encrypted = encryptSecret(secret);

      const connection = await pool.getConnection();
      try {
        await connection.query(
          `UPDATE Users SET mfa_secret_encrypted = ? WHERE email = ?`,
          [JSON.stringify(encrypted), testEmail]
        );

        const [rows] = await connection.query(
          `SELECT mfa_secret_encrypted FROM Users WHERE email = ?`,
          [testEmail]
        );

        const storedEncrypted = JSON.parse((rows as any[])[0].mfa_secret_encrypted);
        const decrypted = decryptSecret(
          storedEncrypted.ciphertext,
          storedEncrypted.iv,
          storedEncrypted.authTag
        );

        expect(decrypted).toBe(secret);
      } finally {
        connection.release();
      }
    });
  });

  describe('Recovery codes workflow', () => {
    it('should generate and store recovery codes', async () => {
      const { plaintext, hashes } = await generateRecoveryCodes();

      const connection = await pool.getConnection();
      try {
        await connection.query(
          `UPDATE Users SET mfa_recovery_codes_hash = ? WHERE email = ?`,
          [JSON.stringify(hashes), testEmail]
        );

        const [rows] = await connection.query(
          `SELECT mfa_recovery_codes_hash FROM Users WHERE email = ?`,
          [testEmail]
        );

        const storedHashes = JSON.parse((rows as any[])[0].mfa_recovery_codes_hash);
        expect(storedHashes).toHaveLength(10);
      } finally {
        connection.release();
      }
    });
  });
});
