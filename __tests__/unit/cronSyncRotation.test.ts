// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { rotateDaily } from '@/app/api/cron/sync/route';

/**
 * El barrido del cron `sync` es secuencial, así que el último tenant de la lista
 * corre con el rate-limit de Cost Management más gastado y es el que más días
 * pierde por 429. La rotación diaria reparte ese costo.
 */
describe('rotateDaily', () => {
    const tenants = ['a', 'b', 'c', 'd'];

    it('rota un puesto por día', () => {
        const day1 = new Date('2026-07-30T00:00:00Z');
        const day2 = new Date('2026-07-31T00:00:00Z');
        const day3 = new Date('2026-08-01T00:00:00Z');

        const r1 = rotateDaily(tenants, day1);
        const r2 = rotateDaily(tenants, day2);
        const r3 = rotateDaily(tenants, day3);

        expect(r1[0]).not.toBe(r2[0]);
        expect(r2[0]).not.toBe(r3[0]);
        // Un puesto exacto: el primero de un día es el segundo del día anterior.
        expect(r2[0]).toBe(r1[1]);
        expect(r3[0]).toBe(r2[1]);
    });

    it('no pierde ni duplica tenants', () => {
        for (let i = 0; i < 10; i++) {
            const day = new Date(Date.UTC(2026, 6, 20 + i));
            const rotated = rotateDaily(tenants, day);
            expect([...rotated].sort()).toEqual([...tenants].sort());
            expect(rotated).toHaveLength(tenants.length);
        }
    });

    it('vuelve al mismo orden después de un ciclo completo', () => {
        const start = new Date('2026-07-30T00:00:00Z');
        const afterCycle = new Date('2026-08-03T00:00:00Z'); // +4 días, 4 tenants
        expect(rotateDaily(tenants, afterCycle)).toEqual(rotateDaily(tenants, start));
    });

    it('no toca listas de 0 o 1 elemento', () => {
        const day = new Date('2026-07-30T00:00:00Z');
        expect(rotateDaily([], day)).toEqual([]);
        expect(rotateDaily(['solo'], day)).toEqual(['solo']);
    });
});
