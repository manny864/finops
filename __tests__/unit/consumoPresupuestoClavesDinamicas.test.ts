import { describe, it, expect } from 'vitest';
import { createTranslator } from 'next-intl';
import es from '@/../messages/es.json';
import en from '@/../messages/en.json';
import ptBR from '@/../messages/pt-BR.json';
import { getServiceRemediationRule, getMockRealConsumptionOverview } from '@/services/realConsumptionService';
import { getCategoryRemediationRule } from '@/services/categoryConsumptionService';

const LOCALES: [string, any][] = [['es', es], ['en', en], ['pt-BR', ptBR]];
const trad = (locale: string, messages: any, ns: string) =>
    createTranslator({ locale, messages, namespace: ns }) as unknown as (
        k: string,
        args?: Record<string, string | number>
    ) => string;

/**
 * consumo-y-presupuesto y por-categoria mandaban la prosa desde el servidor, que no
 * conoce el locale del lector: recomendaciones, etiquetas de boton y sugerencias por
 * recurso salian en espanol con la UI en ingles o portugues. Ahora el payload lleva
 * solo la clave (remediationActionKey / *Key) y la UI resuelve el texto. Esas claves
 * se arman en runtime, invisibles para i18nKeyIntegrity, por eso el guard va aca.
 */
describe('consumo-y-presupuesto: las claves dinamicas existen en los tres idiomas', () => {
    // Nombres de servicio que disparan cada rama de getServiceRemediationRule
    const SERVICIOS = ['Redis Cache', 'Azure AI Search', 'Container Registry', 'Container Apps',
        'Azure AI Foundry', 'Virtual Network', 'Virtual Machines', 'Storage Accounts', 'Servicio Raro'];
    const CATEGORIAS = ['Databases', 'Compute', 'Networking', 'AI and Machine Learning',
        'Storage', 'Management and Governance'];

    it('cada regla de servicio resuelve su recomendacion y su etiqueta', () => {
        for (const [locale, messages] of LOCALES) {
            const t = trad(locale, messages, 'RealConsumptionMonitor');
            for (const nombre of SERVICIOS) {
                const { remediationActionKey } = getServiceRemediationRule(nombre, 100);
                for (const texto of [t(`rc_rec_${remediationActionKey}`), t(`rc_act_${remediationActionKey}`)]) {
                    expect(texto, `${locale} · ${nombre}`).not.toContain('rc_');
                    expect(texto, `${locale} · ${nombre}`).not.toMatch(/[{}]/);
                }
            }
        }
    });

    it('cada regla de categoria resuelve su recomendacion, con topService interpolado', () => {
        for (const [locale, messages] of LOCALES) {
            const t = trad(locale, messages, 'CostByCategory');
            for (const cat of CATEGORIAS) {
                const regla: any = getCategoryRemediationRule(cat, 100, 'Azure MySQL');
                for (const texto of [t(`cc_rec_${regla.remediationActionKey}`, regla.params),
                                     t(`cc_act_${regla.remediationActionKey}`)]) {
                    expect(texto, `${locale} · ${cat}`).not.toContain('cc_');
                    expect(texto, `${locale} · ${cat}`).not.toMatch(/[{}]/);
                }
            }
            expect(t('cc_rec_db_reservations_and_scale', getCategoryRemediationRule('Databases', 100, 'Azure MySQL').params))
                .toContain('Azure MySQL');
        }
    });

    it('las sugerencias por recurso del tenant demo son claves resolubles', () => {
        const overview: any = getMockRealConsumptionOverview('demo-tenant');
        const claves = overview.services
            .flatMap((s: any) => s.resources || [])
            .map((r: any) => r.remediationSuggestedKey)
            .filter(Boolean);
        expect(claves.length).toBeGreaterThan(10);
        for (const [locale, messages] of LOCALES) {
            const t = trad(locale, messages, 'RealConsumptionMonitor');
            for (const clave of claves) {
                expect(t(clave), `${locale} · ${clave}`).not.toContain(clave);
            }
        }
    });

    it('el payload ya no trae prosa: ni recommendation ni remediationActionLabel', () => {
        const overview: any = getMockRealConsumptionOverview('demo-tenant');
        for (const s of overview.services) {
            expect(s).not.toHaveProperty('recommendation');
            expect(s).not.toHaveProperty('remediationActionLabel');
            expect(s).not.toHaveProperty('anomalyDetail');
        }
        // El bucket agregado viaja sin nombre; la UI lo resuelve por serviceKey
        const otros = overview.top5ShareOfWallet.find((i: any) => i.serviceKey === 'others');
        if (otros) expect(otros.name).toBe('');
        for (const [locale, messages] of LOCALES) {
            expect(trad(locale, messages, 'RealConsumptionMonitor')('otherServices')).not.toContain('otherServices');
        }
    });

    it('el modal de remediacion resuelve sus textos y los comentarios de los scripts', () => {
        const SIN_PARAM = ['fo_defaultTitle', 'fo_tabSteps', 'fo_copied', 'fo_copyScript', 'fo_openPortal',
            'fo_toastCopied', 'fo_risk_low', 'fo_risk_medium', 'fo_risk_high',
            'sc_sql_h', 'sc_sql_1', 'sc_sql_2', 'sc_app_h', 'sc_app_1', 'sc_app_2',
            'sc_sto_h', 'sc_sto_1', 'sc_vm_h', 'sc_vm_1', 'sc_vm_2', 'sc_vm_3',
            'sc_ps_1', 'sc_ps_2', 'sc_ps_msg1', 'sc_ps_msg2',
            'sc_tf_h', 'sc_tf_1', 'sc_tf_2', 'sc_tf_3', 'sc_tf_4'];
        const CON_NOMBRE = ['fo_defaultDesc', 'sc_gen_h', 'sc_ps_h'];
        for (const [locale, messages] of LOCALES) {
            const t = trad(locale, messages, 'RemediationModals');
            for (const k of SIN_PARAM) {
                const texto = t(k);
                expect(texto, `${locale} · ${k}`).not.toContain(k);
                expect(texto, `${locale} · ${k}`).not.toMatch(/[{}]/);
            }
            for (const k of CON_NOMBRE) {
                const texto = t(k, { name: 'vm-prod-01' });
                expect(texto, `${locale} · ${k}`).toContain('vm-prod-01');
                expect(texto, `${locale} · ${k}`).not.toMatch(/[{}]/);
            }
        }
    });
});
