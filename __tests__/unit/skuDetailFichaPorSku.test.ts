import { describe, it, expect } from 'vitest';
import { getMockDataForRoute } from '@/lib/mockData';
import { vmSizeToCores, vmSizeToMemoryGB } from '@/modules/collectors/azure/aksCostService';

/**
 * La tabla "By SKU & Architecture" mostraba el agregado de la flota en las columnas
 * de tamaño: con 2x Standard_D2ds_v6 decía 4 vCPU / 16 GiB en vez de 2 / 8. Las
 * columnas ahora llevan la ficha de UNA instancia y los ratios $/core y $/GiB
 * siguen dividiendo por la flota (instances x cores).
 */
describe('skuDetail: ficha del SKU vs agregado de la flota', () => {
    it('vmSizeToCores/vmSizeToMemoryGB devuelven la ficha real del SKU reportado', () => {
        expect(vmSizeToCores('Standard_D2ds_v6')).toBe(2);
        expect(vmSizeToMemoryGB('Standard_D2ds_v6')).toBe(8);
        expect(vmSizeToCores('Standard_D4ds_v5')).toBe(4);
        expect(vmSizeToMemoryGB('Standard_D4ds_v5')).toBe(16);
    });

    it('las filas del mock traen la ficha por instancia y el conteo aparte', () => {
        const data: any = getMockDataForRoute('compute-efficiency', 'demo-tenant-10');
        expect(data.skuDetail.length).toBeGreaterThan(0);
        for (const fila of data.skuDetail) {
            expect(fila.instances).toBeGreaterThanOrEqual(1);
            // La ficha nunca supera un SKU real: si volviera a multiplicarse por
            // el conteo, cores se dispararía muy por encima del tamaño del SKU.
            expect(fila.cores).toBe(vmSizeToCores(fila.sku));
            expect(fila.ramGiB).toBeGreaterThan(0);
        }
    });

    it('$/core divide por la flota del SKU, no por la ficha', () => {
        const data: any = getMockDataForRoute('compute-efficiency', 'demo-tenant-10');
        for (const fila of data.skuDetail) {
            const flota = fila.instances * fila.cores;
            expect(fila.cost / flota).toBeCloseTo(fila.costPerCore, 0);
        }
    });
});
