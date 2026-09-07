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

/**
 * Las tarjetas del Rate Optimization Engine armaban titulo, descripcion y CTA
 * en la ruta API, en espanol. Ahora viajan como `type` + `params` y la UI las
 * resuelve con claves rateAction_<type>_{title,desc,cta}. Esas claves se
 * construyen en runtime, asi que i18nKeyIntegrity no las ve: este test las cubre.
 */
describe('rateOptimizationActions: type + params en vez de prosa', () => {
    const LOCALES: [string, any][] = [['es', es], ['en', en], ['pt-BR', ptBR]];
    const TIPOS = ['savings_plan', 'arm_migration', 'ahub', 'region_arbitrage'];
    const traductor = (locale: string, messages: any) =>
        createTranslator({ locale, messages, namespace: 'ComputeEfficiency' }) as unknown as (
            k: string,
            args?: Record<string, string | number>
        ) => string;

    it('las 12 claves existen en los tres catalogos y no dejan placeholders sueltos', () => {
        const todos = { cores: 40, from: '38.00', to: '22.04', region: 'brazilsouth', pct: 18 };
        for (const [locale, messages] of LOCALES) {
            const t = traductor(locale, messages);
            for (const tipo of TIPOS) {
                for (const sufijo of ['title', 'desc', 'cta']) {
                    const texto = t(`rateAction_${tipo}_${sufijo}`, todos);
                    expect(texto, `${locale} · ${tipo} · ${sufijo}`).not.toContain('rateAction_');
                    expect(texto, `${locale} · ${tipo} · ${sufijo}`).not.toMatch(/[{}]/);
                }
            }
        }
        // /mes tambien estaba fijo en el JSX
        for (const [locale, messages] of LOCALES) {
            expect(traductor(locale, messages)('perMonth')).not.toContain('perMonth');
        }
    });

    it('los params que emite el mock alcanzan para renderizar cada tarjeta', () => {
        const data: any = getMockDataForRoute('compute-efficiency', 'demo-tenant-10');
        expect(data.rateOptimizationActions.length).toBeGreaterThan(0);
        for (const accion of data.rateOptimizationActions) {
            expect(accion).not.toHaveProperty('title');
            expect(accion).not.toHaveProperty('description');
            expect(accion).not.toHaveProperty('ctaLabel');
            for (const [locale, messages] of LOCALES) {
                const t = traductor(locale, messages);
                for (const sufijo of ['desc', 'cta']) {
                    const texto = t(`rateAction_${accion.type}_${sufijo}`, accion.params);
                    expect(texto, `${locale} · ${accion.type} · ${sufijo}`).not.toMatch(/[{}]/);
                }
            }
        }
    });
});
