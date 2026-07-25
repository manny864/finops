import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import en from '../../messages/en.json';
import es from '../../messages/es.json';
import ptBR from '../../messages/pt-BR.json';
import { isRouteAvailableForProvider, awsEnabledRoutes } from '@/lib/routeProviders';

const LOCALES: Record<string, Record<string, unknown>> = {
    en: en as Record<string, unknown>,
    es: es as Record<string, unknown>,
    'pt-BR': ptBR as Record<string, unknown>,
};

/**
 * Namespaces de i18n que ve un tenant AWS, DERIVADOS DEL CODIGO.
 *
 * No hay lista a mano a proposito: un mapa manual se desactualiza en silencio y
 * eso es exactamente como se colo el "VMs/AKS" que veian los tenants AWS. Se
 * parte del page.tsx de cada ruta habilitada para AWS, se siguen sus imports
 * dentro de src/ y se juntan todos los namespaces que pide el arbol.
 *
 * Solo se siguen imports desde la pagina hacia abajo: el shell global (Sidebar,
 * Topbar) vive en el layout, no en la pagina, asi que no contamina el analisis.
 */
const SRC = path.join(process.cwd(), 'src');

function resolveImport(spec: string, fromFile: string): string | null {
    let base: string;
    if (spec.startsWith('@/')) base = path.join(SRC, spec.slice(2));
    else if (spec.startsWith('.')) base = path.resolve(path.dirname(fromFile), spec);
    else return null;
    for (const cand of [`${base}.tsx`, `${base}.ts`, path.join(base, 'index.tsx'), path.join(base, 'index.ts')]) {
        if (fs.existsSync(cand)) return cand;
    }
    return null;
}

function namespacesOf(entry: string, seen = new Set<string>()): Set<string> {
    const out = new Set<string>();
    if (seen.has(entry) || !fs.existsSync(entry)) return out;
    seen.add(entry);
    const src = fs.readFileSync(entry, 'utf-8');
    for (const m of src.matchAll(/(?:useTranslations|useProviderTranslations|getTranslations)\s*\(\s*['"]([^'"]+)['"]/g)) {
        out.add(m[1]);
    }
    for (const m of src.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
        const resolved = resolveImport(m[1], entry);
        if (resolved) for (const ns of namespacesOf(resolved, seen)) out.add(ns);
    }
    return out;
}

function pageFileFor(route: string): string | null {
    const rel = route === '/' ? '' : route;
    const file = path.join(SRC, 'app', '[locale]', rel, 'page.tsx');
    return fs.existsSync(file) ? file : null;
}

/**
 * Rutas sin UI traducible propia. Son excepciones justificadas, no una lista
 * para silenciar el test: el caso de abajo verifica que sigan sin `page.tsx`
 * (o siendo un redirect), asi que si alguna gana pantalla propia el test falla.
 */
const ROUTES_WITHOUT_OWN_UI: Record<string, string> = {
    '/': 'redirect post-login hacia /whiteboard, no renderiza UI propia',
    '/legal': 'seccion contenedora: la UI vive en sus subrutas',
    '/superadmin': 'seccion contenedora: la UI vive en sus subrutas',
};

const ROUTE_NAMESPACES: Record<string, string[]> = Object.fromEntries(
    awsEnabledRoutes().map((route) => {
        const file = pageFileFor(route);
        return [route, file ? [...namespacesOf(file)] : []];
    })
);

/**
 * Prefijos de las paginas que muestran DATOS DE NUBE del tenant. Son las que
 * este test vigila de forma estricta, porque son las que describen los recursos
 * y los costos del cliente: ahi "AKS" o "Resource Group" es lisa y llanamente
 * falso para un tenant AWS.
 *
 * Quedan afuera a proposito `/admin/*`, `/upgrade`, `/support` y `/academy`:
 * hablan del SaaS, no de la nube del cliente, y su palabra "Subscription" es la
 * suscripcion comercial al producto (la que se cancela desde Paddle), no una
 * Azure Subscription. Mezclarlas volvia el test inservible por ambiguedad.
 */
const CLOUD_DATA_PREFIXES = ['/intelligence', '/governance', '/overview', '/cleanup', '/advisor'];

const AWS_FACING_CLOUD_NAMESPACES = Object.entries(ROUTE_NAMESPACES)
    .filter(([route]) => CLOUD_DATA_PREFIXES.some((p) => route.startsWith(p)))
    .flatMap(([route, namespaces]) => namespaces.map((ns) => ({ ns, route })));

/** Namespaces efectivamente revisados, derivados del mapa de arriba. */
const AWS_FACING_NAMESPACES: Array<{ ns: string; route: string }> = Object.entries(ROUTE_NAMESPACES)
    .flatMap(([route, namespaces]) => namespaces.map((ns) => ({ ns, route })));

/**
 * Términos que sólo existen en Azure. Si aparecen en una cadena servida a un
 * tenant AWS, la pantalla está mintiendo (AKS no existe en AWS; tampoco las
 * suscripciones ni el Azure Hybrid Benefit).
 */
const PLATFORM_PRODUCT_TERMS = [
    // Microsoft/Azure como producto de NUESTRA plataforma, no como la nube cuyos
    // costos mira el tenant. A un cliente AWS le decimos "Azure OpenAI" o
    // "Microsoft Teams" con toda propiedad: son el motor de IA y el canal de
    // notificaciones del SaaS, no sus recursos.
    'Azure OpenAI', 'Microsoft Teams', 'Azure Marketplace', 'AWS Marketplace',
    'Microsoft 365', 'Power BI', 'Entra', 'onmicrosoft.com', 'Microsoft Partner',
    'Azure AD', 'Microsoft Graph', 'Azure Key Vault',
];

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
            for (const { ns } of AWS_FACING_CLOUD_NAMESPACES) {
                for (const [key, value] of Object.entries(flat)) {
                    if (!key.startsWith(`${ns}.`)) continue;
                    if (key.endsWith('_aws')) continue;
                    // Se tapan primero los nombres de producto de la plataforma:
                    // "Azure OpenAI" no debe contar como el termino "Azure".
                    let scrubbed = value;
                    for (const product of PLATFORM_PRODUCT_TERMS) {
                        scrubbed = scrubbed.replace(new RegExp(product, 'gi'), '');
                    }
                    const hit = AZURE_ONLY_TERMS.find((term) =>
                        new RegExp(`\\b${term}\\b`, 'i').test(scrubbed));
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

    it('deriva al menos un namespace por cada ruta habilitada para AWS con UI propia', () => {
        // Este es el test que hace automatica la revision: habilitar una pagina
        // para AWS sin que su terminologia entre al analisis de arriba vuelve a
        // producir el "VMs/AKS" que veian los tenants AWS. Falla aca, no en prod.
        const empty = Object.entries(ROUTE_NAMESPACES)
            .filter(([route, ns]) => ns.length === 0 && !(route in ROUTES_WITHOUT_OWN_UI))
            .map(([r]) => r);
        expect(empty,
            `Rutas habilitadas para AWS sin namespace de i18n detectado: ${empty.join(', ')}. `
            + 'Revisa que la pagina use useTranslations/useProviderTranslations, '
            + 'o declarala en ROUTES_WITHOUT_OWN_UI con su motivo.').toEqual([]);
    });

    it('las rutas exentas siguen sin UI traducible propia', () => {
        for (const [route, motivo] of Object.entries(ROUTES_WITHOUT_OWN_UI)) {
            const file = pageFileFor(route);
            const ns = file ? [...namespacesOf(file)] : [];
            expect(ns, `${route} esta exenta ("${motivo}") pero ahora pide namespaces: ${ns.join(', ')}`).toEqual([]);
        }
    });

    it('los namespaces declarados existen en los diccionarios', () => {
        const flat = flatten(LOCALES.en);
        for (const { ns, route } of AWS_FACING_NAMESPACES) {
            const exists = Object.keys(flat).some((k) => k.startsWith(`${ns}.`));
            expect(exists, `${route} declara el namespace "${ns}", que no existe en messages/en.json`).toBe(true);
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

describe('onboarding AWS - limitaciones declaradas', () => {
    it('la pantalla de alta advierte que sin CUR no hay tags', () => {
        // Cost Explorer no devuelve tags de recurso: un tenant que solo conecte
        // CE se queda sin allocation, chargeback ni unit economics. Si el aviso
        // no esta, el cliente lo descubre cuando ya cargo todo en "Sin asignar".
        const page = fs.readFileSync(
            path.join(SRC, 'app', '[locale]', 'admin', 'cloud-accounts', 'page.tsx'), 'utf-8');
        expect(page).toContain("t('curSectionWarning')");
    });

    it('el aviso existe en los tres idiomas y nombra lo que se pierde', () => {
        for (const [lang, dict] of Object.entries(LOCALES)) {
            const warning = (dict.AdminCloudAccounts as Record<string, string>)?.curSectionWarning;
            expect(warning, `${lang} no tiene AdminCloudAccounts.curSectionWarning`).toBeTruthy();
            expect(/chargeback/i.test(warning), `${lang}: el aviso no menciona el chargeback`).toBe(true);
        }
    });
});
