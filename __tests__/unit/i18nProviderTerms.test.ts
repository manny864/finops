import { describe, it, expect } from 'vitest';
import en from '../../messages/en.json';
import es from '../../messages/es.json';
import ptBR from '../../messages/pt-BR.json';
import { isRouteAvailableForProvider } from '@/lib/routeProviders';

const LOCALES: Record<string, Record<string, unknown>> = {
    en: en as Record<string, unknown>,
    es: es as Record<string, unknown>,
    'pt-BR': ptBR as Record<string, unknown>,
};

/**
 * Namespaces de i18n que usan las páginas ya habilitadas para AWS. Si se
 * habilita una página nueva en routeProviders.ts, su namespace va acá.
 */
const AWS_FACING_NAMESPACES: Array<{ ns: string; route: string }> = [
    { ns: 'Simulator', route: '/intelligence/simulator' },
    { ns: 'CostGroups', route: '/intelligence/cost-groups' },
    { ns: 'CostByCategory', route: '/intelligence/cost-by-category' },
];

/**
 * Términos que sólo existen en Azure. Si aparecen en una cadena servida a un
 * tenant AWS, la pantalla está mintiendo (AKS no existe en AWS; tampoco las
 * suscripciones ni el Azure Hybrid Benefit).
 */
const AZURE_ONLY_TERMS = [
    'AKS', 'AHB', 'Azure', 'Microsoft',
    'Suscripción', 'Suscripciones', 'Subscription', 'Subscriptions', 'Assinatura', 'Assinaturas',
    'Resource Group', 'Management Group', 'Hybrid Benefit',
];

function flatten(obj: Record<string, unknown>, prefix = ''): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(obj)) {
        const key = prefix ? `${prefix}.${k}` : k;
        if (v && typeof v === 'object' && !Array.isArray(v)) {
            Object.assign(out, flatten(v as Record<string, unknown>, key));
        } else if (typeof v === 'string') {
            out[key] = v;
        } else if (Array.isArray(v)) {
            v.forEach((item, i) => { if (typeof item === 'string') out[`${key}.${i}`] = item; });
        }
    }
    return out;
}

describe('i18n - variantes por proveedor', () => {
    it('mantiene la paridad de claves entre los tres idiomas', () => {
        const keys = Object.entries(LOCALES).map(([lang, dict]) => [lang, Object.keys(flatten(dict)).sort()] as const);
        const [, base] = keys[0];
        for (const [lang, k] of keys.slice(1)) {
            expect(k, `${lang} difiere de ${keys[0][0]}`).toEqual(base);
        }
    });

    it('toda clave _aws tiene su clave base correspondiente', () => {
        for (const [lang, dict] of Object.entries(LOCALES)) {
            const flat = flatten(dict);
            for (const key of Object.keys(flat)) {
                if (!key.endsWith('_aws')) continue;
                const base = key.slice(0, -'_aws'.length);
                expect(flat[base], `${lang}: ${key} no tiene base ${base}`).toBeDefined();
            }
        }
    });

    it('las páginas habilitadas para AWS no exponen terminología exclusiva de Azure', () => {
        const offenders: string[] = [];
        for (const [lang, dict] of Object.entries(LOCALES)) {
            const flat = flatten(dict);
            for (const { ns } of AWS_FACING_NAMESPACES) {
                for (const [key, value] of Object.entries(flat)) {
                    if (!key.startsWith(`${ns}.`)) continue;
                    if (key.endsWith('_aws')) continue;
                    const hit = AZURE_ONLY_TERMS.find((term) =>
                        new RegExp(`\\b${term}\\b`, 'i').test(value));
                    if (!hit) continue;
                    // Con variante AWS definida, el término de Azure es correcto
                    // para Azure y nunca se le muestra a un tenant AWS.
                    if (flat[`${key}_aws`] !== undefined) continue;
                    offenders.push(`${lang}: ${key} contiene "${hit}" y no tiene variante _aws → "${value}"`);
                }
            }
        }
        expect(offenders, offenders.join('\n')).toEqual([]);
    });

    it('las rutas cubiertas por este test siguen habilitadas para AWS', () => {
        for (const { route } of AWS_FACING_NAMESPACES) {
            expect(isRouteAvailableForProvider(route, 'aws'), `${route} ya no acepta AWS`).toBe(true);
        }
    });

    it('las variantes AWS no reintroducen terminología de Azure', () => {
        for (const [lang, dict] of Object.entries(LOCALES)) {
            const flat = flatten(dict);
            for (const [key, value] of Object.entries(flat)) {
                if (!key.endsWith('_aws')) continue;
                for (const term of ['AKS', 'AHB', 'Hybrid Benefit', 'Resource Group', 'Management Group']) {
                    expect(new RegExp(`\\b${term}\\b`, 'i').test(value),
                        `${lang}: ${key} usa "${term}" → "${value}"`).toBe(false);
                }
            }
        }
    });
});
