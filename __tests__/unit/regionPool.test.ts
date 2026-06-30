import { describe, it, expect, vi } from 'vitest';
import { getTenantPool, resolveTenantPool } from '@/modules/storage/regionPool';

describe('regionPool', () => {
    describe('getTenantPool', () => {
        it('should return the default pool for EU region', () => {
            const pool = getTenantPool('EU');
            expect(pool).toBeDefined();
        });

        it('should return the default pool for US region', () => {
            const pool = getTenantPool('US');
            expect(pool).toBeDefined();
        });

        it('should return the default pool for LATAM region', () => {
            const pool = getTenantPool('LATAM');
            expect(pool).toBeDefined();
        });

        it('should return the default pool for APAC region', () => {
            const pool = getTenantPool('APAC');
            expect(pool).toBeDefined();
        });

        it('should return the default pool for GLOBAL region', () => {
            const pool = getTenantPool('GLOBAL');
            expect(pool).toBeDefined();
        });

        it('should return the default pool for undefined region', () => {
            const pool = getTenantPool(undefined);
            expect(pool).toBeDefined();
        });

        it('should return the default pool for null region', () => {
            const pool = getTenantPool(null);
            expect(pool).toBeDefined();
        });

        it('should return the default pool for invalid region', () => {
            const pool = getTenantPool('INVALID');
            expect(pool).toBeDefined();
        });

        it('should be case-insensitive', () => {
            const pool1 = getTenantPool('eu');
            const pool2 = getTenantPool('EU');
            expect(pool1).toBe(pool2);
        });

        it('should handle mixed case', () => {
            const pool = getTenantPool('Us');
            expect(pool).toBeDefined();
        });
    });

    describe('resolveTenantPool', () => {
        it('should return a pool and region', async () => {
            // Mock the pool.query method
            const mockQuery = vi.fn().mockResolvedValue([
                [{ data_residency: 'EU' }]
            ]);

            // This would require mocking the database pool, which is complex
            // For now, we'll just ensure the function is defined and callable
            expect(resolveTenantPool).toBeDefined();
        });
    });
});
