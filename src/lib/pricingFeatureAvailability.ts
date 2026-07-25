/**
 * Qué features de cada plan existen hoy para un tenant AWS.
 *
 * La tabla de precios es pre-login: no hay tenant ni proveedor en contexto, así
 * que el visitante elige la nube con un selector y esta lista decide qué se le
 * muestra como disponible. Sin esto, un prospecto de AWS leía "Asesor de Azure"
 * o "Azure Lighthouse Onboarding" como parte de lo que estaba comprando.
 *
 * Los índices son posicionales sobre `pricing.<tier>.features` de
 * `messages/*.json`. Es frágil ante un reordenamiento, y por eso hay un test
 * (`__tests__/unit/pricingFeatureAvailability.test.ts`) que verifica que sigan
 * en rango y que ninguna feature marcada como disponible en AWS mencione un
 * producto exclusivo de Azure.
 *
 * Criterio: la feature entra acá sólo si un tenant AWS la tiene funcionando
 * **hoy**. Lo que está en el roadmap no cuenta — la lista se actualiza cuando
 * la capability se habilita de verdad, no cuando se planifica. La fuente de la
 * clasificación es `docs/finops-framework-coverage.md`.
 */
export const AWS_AVAILABLE_FEATURES: Record<string, readonly number[]> = {
    // 0 scope · 1 WhiteBoard (landing post-login, parametrizada por proveedor) ·
    // 4 dashboard de consumo · 10 exportaciones · 13 academia ·
    // 15 usuarios y config · 16 multi-moneda · 17 soporte. Queda afuera todo lo
    // que necesita inventario de recursos (zombies, etiquetas, costo cero) o
    // Azure Advisor.
    essential: [0, 1, 4, 10, 13, 15, 16, 17],

    // 5 es Ahorro Capturado, que lee los snapshots del dashboard y por eso sirve
    // para las dos nubes. 10 es FOCUS: el sync de AWS ya normaliza a ese esquema.
    pro: [0, 1, 5, 8, 9, 10, 13, 14, 15, 16],

    // 3, 8 y 9 son las páginas de costo habilitadas para AWS (Cost Groups,
    // What-If y Costos por Categoría). En AWS los Cost Groups agrupan por región.
    business: [0, 1, 3, 8, 9, 10, 11, 21, 22],

    // Casi todo lo de Enterprise es optimización sobre inventario de recursos,
    // que en AWS todavía no se ingesta. Sobrevive lo transversal: integraciones,
    // API pública, SSO, Power BI y facturación.
    enterprise: [0, 1, 16, 21, 24, 25, 26, 27, 28, 29, 31, 33],
};

export type PricingCloud = 'azure' | 'aws';

/** Indica si la feature `index` del plan `tier` está disponible en `cloud`. */
export function isFeatureAvailable(tier: string, index: number, cloud: PricingCloud): boolean {
    if (cloud === 'azure') return true;
    return AWS_AVAILABLE_FEATURES[tier]?.includes(index) ?? false;
}
