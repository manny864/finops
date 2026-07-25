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

    // 3 es TOP Gastos: rankea CostSnapshots, asi que sirve para las dos nubes
    // (en AWS agrupa por cuenta y region). 5 es Ahorro Capturado, que lee los
    // snapshots del dashboard. 10 es FOCUS: el sync de AWS ya normaliza a ese
    // esquema.
    // 4 es Green FinOps: usa los mismos factores de emision que Azure,
    // ampliados con las regiones AWS, sobre el inventario EC2.
    pro: [0, 1, 3, 4, 5, 8, 9, 10, 13, 14, 15, 16],

    // 3, 8 y 9 son las páginas de costo habilitadas para AWS (Cost Groups,
    // What-If y Costos por Categoría). En AWS los Cost Groups agrupan por región.
    business: [0, 1, 3, 8, 9, 10, 11, 21, 22],

    // Casi todo lo de Enterprise es optimización sobre inventario de recursos,
    // que en AWS todavía no se ingesta. Sobrevive lo transversal (integraciones,
    // API pública, SSO, Power BI y facturación) más 11, la detección de
    // anomalías: el Z-Score corre sobre CostSnapshots, que las dos nubes llenan.
    // 2 (Presupuesto por Centro de Costos), 9 (Unit Economics) y 10 (Allocation)
    // entran a partir de la migración 20260728-001, que agrega la dimensión de
    // etiqueta a la clave única de CostSnapshots: antes el agregado diario
    // colapsaba las filas con distinto centro de costo y en AWS todo el gasto
    // caía en "Sin asignar". Requiere el CUR — el camino de Cost Explorer no
    // trae etiquetas de recurso.
    // 13 es Gastos y Proyeccion: la serie sale de CostSnapshots y en AWS se
    // saltea el backfill contra Azure, que ya no hace falta.
    // 4 (Optimizacion de Tarifas) y 6 (Reservas) entran con las recomendaciones
    // de compra de Cost Explorer: Reserved Instances y Savings Plans, que AWS
    // calcula sobre el uso real de los ultimos 30 dias.
    enterprise: [0, 1, 2, 4, 6, 9, 10, 11, 13, 16, 21, 24, 25, 26, 27, 28, 29, 31, 33],
};

export type PricingCloud = 'azure' | 'aws';

/** Indica si la feature `index` del plan `tier` está disponible en `cloud`. */
export function isFeatureAvailable(tier: string, index: number, cloud: PricingCloud): boolean {
    if (cloud === 'azure') return true;
    return AWS_AVAILABLE_FEATURES[tier]?.includes(index) ?? false;
}
