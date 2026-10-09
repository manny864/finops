/**
 * Datos de demostración de Shift-Left (MEJ-20). Sin esto la pantalla del tenant
 * de demo queda vacía y parece rota, no vacía.
 *
 * Los montos no son inventados al azar: son los del catálogo para West US 2
 * (VM D4s_v3 Linux 140,16/mes, Azure Firewall Standard 912,50, App Service P1v3
 * Linux 113,15 por worker…), de modo que el desglose que ve el cliente en la demo
 * coincide con lo que vería en un plan real.
 */

export interface LineaDemo {
    direccion: string;
    tipo: string;
    accion: string;
    region: string;
    mensualAntes: number;
    mensualDespues: number;
    delta: number;
    componentes?: Array<{ etiqueta: string; cantidad: number; mensual: number }>;
    notas?: string[];
    motivo?: string;
}

const hace = (horas: number) => new Date(Date.now() - horas * 3600e3).toISOString();

const LINEAS: Record<number, LineaDemo[]> = {
    3: [
        { direccion: "azurerm_kubernetes_cluster_node_pool.batch", tipo: "azurerm_kubernetes_cluster_node_pool", accion: "update", region: "westus2",
          mensualAntes: 560.64, mensualDespues: 280.32, delta: -280.32,
          componentes: [{ etiqueta: "nodos", cantidad: 2, mensual: 280.32 }], notas: ["region-inferida", "discos-os-no-incluidos"] },
        { direccion: "azurerm_public_ip.legacy", tipo: "azurerm_public_ip", accion: "create", region: "westus2",
          mensualAntes: 0, mensualDespues: 3.65, delta: 3.65, componentes: [{ etiqueta: "IP pública", cantidad: 1, mensual: 3.65 }] },
        { direccion: "azurerm_storage_account.logs", tipo: "azurerm_storage_account", accion: "update", region: "westus2",
          mensualAntes: 0, mensualDespues: 0, delta: 0, motivo: "por-uso" },
    ],
    2: [
        { direccion: "azurerm_firewall.hub", tipo: "azurerm_firewall", accion: "create", region: "westus2",
          mensualAntes: 0, mensualDespues: 912.5, delta: 912.5,
          componentes: [{ etiqueta: "despliegue", cantidad: 1, mensual: 912.5 }], notas: ["datos-procesados-no-incluidos"] },
        { direccion: "azurerm_linux_virtual_machine_scale_set.api", tipo: "azurerm_linux_virtual_machine_scale_set", accion: "create", region: "westus2",
          mensualAntes: 0, mensualDespues: 280.32, delta: 280.32,
          componentes: [{ etiqueta: "cómputo", cantidad: 2, mensual: 280.32 }], notas: ["disco-os-no-incluido"] },
        { direccion: "azurerm_service_plan.web", tipo: "azurerm_service_plan", accion: "create", region: "westus2",
          mensualAntes: 0, mensualDespues: 113.15, delta: 113.15, componentes: [{ etiqueta: "plan", cantidad: 1, mensual: 113.15 }] },
        { direccion: "azurerm_public_ip.fw", tipo: "azurerm_public_ip", accion: "create", region: "westus2",
          mensualAntes: 0, mensualDespues: 3.65, delta: 3.65, componentes: [{ etiqueta: "IP pública", cantidad: 1, mensual: 3.65 }] },
        { direccion: "azurerm_databricks_workspace.analytics", tipo: "azurerm_databricks_workspace", accion: "create", region: "westus2",
          mensualAntes: 0, mensualDespues: 0, delta: 0, motivo: "tipo-no-soportado" },
    ],
    1: [
        { direccion: "azurerm_managed_disk.datos", tipo: "azurerm_managed_disk", accion: "create", region: "westus2",
          mensualAntes: 0, mensualDespues: 19.71, delta: 19.71, componentes: [{ etiqueta: "disco", cantidad: 1, mensual: 19.71 }] },
    ],
};

export function itemsDemo() {
    return [
        { id: 3, repository: "acme/infra-azure", pr_number: 412, author: "lucia", delta_cost_usd: -184.32, current_monthly_cost_usd: 612.5, projected_monthly_cost_usd: 428.18, resources_priced: 9, resources_unpriced: 1, gate_status: "OK", created_at: hace(1),
          meta: { tool: "terraform", discount_pct: 0, list_delta_cost_usd: -184.32, resources_by_use: 1, gate_reason: null, budget: { cost_center: "Plataforma", monthly_usd: 4000, spent_usd: 1450, remaining_usd: 2550, delta_pct_of_budget: -4.61, delta_pct_of_remaining: -7.23 } } },
        { id: 2, repository: "acme/infra-azure", pr_number: 409, author: "martin", delta_cost_usd: 1240.0, current_monthly_cost_usd: 612.5, projected_monthly_cost_usd: 1852.5, resources_priced: 4, resources_unpriced: 1, gate_status: "EXCEEDED", created_at: hace(26),
          meta: { tool: "terraform", discount_pct: 0, list_delta_cost_usd: 1240.0, resources_by_use: 0, gate_reason: "usd", budget: { cost_center: "Plataforma", monthly_usd: 4000, spent_usd: 1450, remaining_usd: 2550, delta_pct_of_budget: 31, delta_pct_of_remaining: 48.63 } } },
        { id: 4, repository: "acme/infra-azure", pr_number: 409, author: "martin", delta_cost_usd: 1900.0, current_monthly_cost_usd: 612.5, projected_monthly_cost_usd: 2512.5, resources_priced: 5, resources_unpriced: 1, gate_status: "EXCEEDED", created_at: hace(30),
          meta: { tool: "terraform", discount_pct: 0, list_delta_cost_usd: 1900.0, resources_by_use: 0, gate_reason: "usd", budget: null } },
        { id: 1, repository: "acme/plataforma", pr_number: 77, author: "sofia", delta_cost_usd: 19.71, current_monthly_cost_usd: 0, projected_monthly_cost_usd: 19.71, resources_priced: 1, resources_unpriced: 0, gate_status: "NOT_EVALUATED", created_at: hace(5 * 24),
          meta: { tool: "tofu", discount_pct: 0, list_delta_cost_usd: 19.71, resources_by_use: 0, gate_reason: null, budget: null } },
    ];
}

export const GATES_DEMO = [
    { repository: "acme/infra-azure", threshold_usd: 500, threshold_pct_of_remaining: 40, cost_center_name: "Plataforma" },
];

export const CENTROS_DEMO = [{ cost_center_name: "Plataforma", monthly_budget_usd: 4000 }, { cost_center_name: "Datos", monthly_budget_usd: 2500 }];

export function detalleDemo(id: number): { item: ReturnType<typeof itemsDemo>[number]; lines: LineaDemo[] } | null {
    const item = itemsDemo().find((i) => i.id === id);
    return item ? { item, lines: LINEAS[id] ?? LINEAS[1] } : null;
}
