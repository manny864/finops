import { describe, it, expect } from 'vitest';
import { createTranslator } from 'next-intl';
import es from '@/../messages/es.json';
import en from '@/../messages/en.json';
import ptBR from '@/../messages/pt-BR.json';
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

/**
 * La columna Accion venia como prosa armada en el servidor, que no conoce el
 * locale del lector: se veia en espanol con la UI en ingles. Ahora viaja como
 * clave + SKU destino y la traduce la UI.
 */
describe('skuDetail: la accion sugerida viaja como clave, no como prosa', () => {
    it('el mock no emite texto, emite clave y parametro', () => {
        const data: any = getMockDataForRoute('compute-efficiency', 'demo-tenant-10');
        const conAccion = data.skuDetail.filter((f: any) => f.suggestedAction);
        expect(conAccion.length).toBeGreaterThan(0);
        for (const fila of conAccion) {
            expect(typeof fila.suggestedAction).toBe('object');
            expect(['arm', 'ahub']).toContain(fila.suggestedAction.key);
        }
    });

    it('los tres catalogos resuelven la accion con el SKU destino', () => {
        const casos: [string, any, string, string][] = [
            ['es', es, 'Migrar a Dps4_v5 (ARM Ampere, ~20% de ahorro)', 'Activar Azure Hybrid Benefit'],
            ['en', en, 'Migrate to Dps4_v5 (ARM Ampere, ~20% savings)', 'Enable Azure Hybrid Benefit'],
            ['pt-BR', ptBR, 'Migrar para Dps4_v5 (ARM Ampere, ~20% de economia)', 'Ativar Azure Hybrid Benefit'],
        ];
        for (const [locale, messages, arm, ahub] of casos) {
            const t = createTranslator({ locale, messages, namespace: 'ComputeEfficiency' }) as unknown as (
                k: string,
                args?: Record<string, string | number>
            ) => string;
            expect(t('skuAction_arm', { sku: 'Dps4_v5' })).toBe(arm);
            expect(t('skuAction_ahub')).toBe(ahub);
        }
    });
});
