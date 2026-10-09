// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { estimarPlan, type LineaEstimacion } from "@/services/iacCostEstimator.service";
import {
    CATALOGO_TF,
    POR_USO,
    SIN_COSTO,
    camposDelCatalogo,
    elegirDisco,
    elegirIp,
    elegirPlanAppService,
    elegirVm,
    masReciente,
    normalizarRegion,
} from "@/services/iacCostCatalog";
import { precioMensualDesdeUnidad, type ItemRetail } from "@/services/pricingService";
import { precioDeFixture, claveDeConsulta, CONSULTAS_CAPTURADAS } from "../helpers/retailFixture";

/**
 * MEJ-20 — el catálogo contra datos reales.
 *
 * Los items salen de la Retail API (capturados el 2026-10-08) y el plan de
 * `terraform plan` real. Estos tests existen por una razón concreta: esa API
 * contesta 200 con el medidor equivocado y nada falla; el síntoma es un costo mal.
 * Cada "no" de abajo es un error que el código anterior COMETÍA.
 */
const DATOS = JSON.parse(readFileSync("__tests__/fixtures/retail-prices-2026-10-08.json", "utf8")).consultas as Record<string, ItemRetail[]>;
const PLAN = JSON.parse(readFileSync("__tests__/fixtures/terraform-plan-azurerm-completo.json", "utf8"));

const items = (k: string): ItemRetail[] => {
    const v = DATOS[k];
    if (!v) throw new Error(`El fixture no tiene ${k}`);
    return v;
};
const mensual = (i: ItemRetail | null): number => {
    expect(i).not.toBeNull();
    return precioMensualDesdeUnidad(i!.retailPrice, i!.unitOfMeasure)!;
};

/** Un plan de un solo recurso, para probar un adaptador por vez. */
async function lineaDe(tipo: string, after: Record<string, unknown>, extra: { actions?: string[]; before?: unknown; unknown?: unknown; otros?: unknown[] } = {}): Promise<LineaEstimacion> {
    const plan = { resource_changes: [
        ...(extra.otros ?? []),
        { address: `${tipo}.x`, type: tipo, change: { actions: extra.actions ?? ["create"], before: extra.before ?? null, after, after_unknown: extra.unknown ?? {} } },
    ] };
    const e = await estimarPlan(plan, { precio: precioDeFixture });
    return e.lineas.find((l) => l.tipo === tipo)!;
}

describe("VMs: el medidor correcto entre seis", () => {
    const d2 = items("Virtual Machines|westus2|armSkuName|Standard_D2s_v3");

    it("la API NO devuelve primero el medidor de la VM", () => {
        // Es la razón de todo el selector: la primera fila es "D2s v3 Spot" de
        // Windows, que el código anterior cotizaba como si fuera la VM.
        expect(d2[0].skuName).toBe("D2s v3 Spot");
        expect(d2[0].productName).toMatch(/Windows/);
    });

    it("Linux a demanda: 0,096/h, no el Spot de 0,0347", () => {
        const i = elegirVm(d2, { windows: false, spot: false });
        expect(i?.retailPrice).toBe(0.096);
        expect(mensual(i)).toBeCloseTo(70.08, 2);
    });

    it("Windows a demanda: 0,188/h, con la licencia", () => {
        expect(elegirVm(d2, { windows: true, spot: false })?.retailPrice).toBe(0.188);
    });

    it("Spot sólo cuando el recurso es Spot, y nunca Low Priority", () => {
        expect(elegirVm(d2, { windows: false, spot: true })?.retailPrice).toBe(0.017741);
        for (const o of [{ windows: false, spot: false }, { windows: true, spot: false }, { windows: false, spot: true }]) {
            expect(elegirVm(d2, o)?.skuName).not.toMatch(/Low Priority/);
        }
    });

    it("Windows con Azure Hybrid Benefit se cobra como Linux: la licencia ya es del cliente", async () => {
        const base = { location: "westus2", size: "Standard_D2s_v3" };
        const sinAhb = await lineaDe("azurerm_windows_virtual_machine", { ...base, license_type: "None" });
        const server = await lineaDe("azurerm_windows_virtual_machine", { ...base, license_type: "Windows_Server" });
        const cliente = await lineaDe("azurerm_windows_virtual_machine", { ...base, license_type: "Windows_Client" });
        expect(sinAhb.mensualDespues).toBeCloseTo(0.188 * 730, 2);
        expect(server.mensualDespues).toBeCloseTo(0.096 * 730, 2);
        expect(cliente.mensualDespues).toBeCloseTo(0.096 * 730, 2);
    });

    it("una VM Spot se cobra al precio Spot y lo avisa", async () => {
        const l = await lineaDe("azurerm_linux_virtual_machine", { location: "westus2", size: "Standard_D2s_v3", priority: "Spot" });
        expect(l.mensualDespues).toBeCloseTo(0.017741 * 730, 2);
        expect(l.notas).toContain("spot-variable");
    });

    it("suma el disco del SO cuando el plan trae su tamaño", async () => {
        const l = await lineaDe("azurerm_linux_virtual_machine", {
            location: "westus2", size: "Standard_D2s_v3",
            os_disk: [{ storage_account_type: "Premium_LRS", disk_size_gb: 64 }],
        });
        // P6 LRS: 64 GiB Premium.
        expect(l.componentes?.map((c) => c.etiqueta)).toEqual(["cómputo", "disco del SO"]);
        expect(l.mensualDespues).toBeCloseTo(70.08 + (l.componentes?.[1].mensual ?? 0), 2);
        expect(l.notas ?? []).not.toContain("disco-os-no-incluido");
    });
});

describe("discos e IPs públicas", () => {
    it("un disco P20 ZRS es el de Managed Disks (109,81), no el de Page Blob ni el Disk Mount", () => {
        const p20 = items("Storage|westus2|skuName|P20 ZRS");
        expect(p20.map((i) => i.meterName)).toContain("P20 ZRS Disk Mount");
        expect(elegirDisco(p20, "P20 ZRS")?.productName).toBe("Premium SSD Managed Disks");
    });

    it("elige el medidor de capacidad de un HDD, no el de operaciones", () => {
        const s10 = items("Storage|westus2|skuName|S10 LRS");
        expect(elegirDisco(s10, "S10 LRS")?.meterName).toBe("S10 LRS Disk");
    });

    it("una IP Standard es la de 'IP Addresses' (0,005), no la del Public IP Prefix (0,006)", () => {
        const std = items("Virtual Network|westus2|skuName|Standard");
        expect(std.some((i) => /prefix/i.test(i.productName))).toBe(true);
        expect(elegirIp(std, { sku: "Standard", ipv: 4, estatica: true })?.retailPrice).toBe(0.005);
    });

    it("distingue una IP Basic estática de una dinámica", () => {
        const basic = items("Virtual Network|westus2|skuName|Basic");
        expect(elegirIp(basic, { sku: "Basic", ipv: 4, estatica: true })?.retailPrice).toBe(0.0036);
        expect(elegirIp(basic, { sku: "Basic", ipv: 4, estatica: false })?.retailPrice).toBe(0.004);
    });
});

describe("App Service Plan", () => {
    const todos = items("Azure App Service|westus2||");
    const precio = (sku: string, linux: boolean) => elegirPlanAppService(todos, { sku, linux })?.retailPrice;

    it("P1v3 de Terraform es P1 v3 en la API, y Linux cuesta menos que Windows", () => {
        expect(precio("P1v3", true)).toBe(0.155);
        expect(precio("P1v3", false)).toBe(0.315);
    });

    it("los SKUs sin espacio en la API (P0v3, P1mv3) siguen funcionando", () => {
        expect(precio("P0v3", true)).toBe(0.0775);
        expect(precio("P1mv3", false)).toBe(0.346);
    });

    it("cubre Basic, Standard y Premium v2", () => {
        expect(precio("B1", true)).toBe(0.017);
        expect(precio("S1", false)).toBe(0.1);
        expect(precio("P2v2", true)).toBe(0.202);
    });

    it("el plan gratuito se cobra 0: es un precio, no una falla", () => {
        expect(precio("F1", true)).toBe(0);
    });

    it("D1 de Terraform es 'Shared' en la API", async () => {
        const l = await lineaDe("azurerm_service_plan", { location: "westus2", sku_name: "D1", os_type: "Windows" });
        expect(l.mensualDespues).toBeCloseTo(0.013 * 730, 2);
    });

    it("lo que no tiene precio fijo no se inventa", async () => {
        // Y1 es por ejecución; EP/WS/I* suman vCPU por segundo o un App Service Environment.
        expect((await lineaDe("azurerm_service_plan", { location: "westus2", sku_name: "Y1", os_type: "Windows" })).motivo).toBe("por-uso");
        expect((await lineaDe("azurerm_service_plan", { location: "westus2", sku_name: "EP1", os_type: "Windows" })).motivo).toBe("sin-sku");
        expect((await lineaDe("azurerm_service_plan", { location: "westus2", sku_name: "I1v2", os_type: "Windows" })).motivo).toBe("sin-sku");
        expect((await lineaDe("azurerm_service_plan", { location: "westus2", sku_name: "P1v3", os_type: "WindowsContainer" })).motivo).toBe("sin-sku");
    });

    it("multiplica por la cantidad de workers", async () => {
        const l = await lineaDe("azurerm_service_plan", { location: "westus2", sku_name: "P1v3", os_type: "Linux", worker_count: 3 });
        expect(l.mensualDespues).toBeCloseTo(0.155 * 730 * 3, 2);
    });
});

describe("Redis", () => {
    it("Standard C1 cobra el caché completo (0,138), no una instancia (0,069)", async () => {
        const l = await lineaDe("azurerm_redis_cache", { location: "westus2", sku_name: "Standard", family: "C", capacity: 1 });
        expect(l.mensualDespues).toBeCloseTo(0.138 * 730, 2);
    });

    it("Premium multiplica por los shards", async () => {
        const uno = await lineaDe("azurerm_redis_cache", { location: "westus2", sku_name: "Premium", family: "P", capacity: 1 });
        const tres = await lineaDe("azurerm_redis_cache", { location: "westus2", sku_name: "Premium", family: "P", capacity: 1, shard_count: 3 });
        expect(uno.mensualDespues).toBeCloseTo(0.555 * 730, 2);
        expect(tres.mensualDespues).toBeCloseTo(uno.mensualDespues * 3, 2);
    });
});

describe("AKS", () => {
    const cluster = (extra: Record<string, unknown> = {}, pool: Record<string, unknown> = {}) => ({
        location: "westus2",
        sku_tier: "Free",
        default_node_pool: [{ vm_size: "Standard_D2s_v3", node_count: 3, ...pool }],
        ...extra,
    });

    it("Free cobra los nodos y ninguna tarifa de plano de control", async () => {
        const l = await lineaDe("azurerm_kubernetes_cluster", cluster());
        expect(l.mensualDespues).toBeCloseTo(3 * 70.08, 2);
        expect(l.componentes).toHaveLength(1);
    });

    it("Standard suma el SLA de disponibilidad (0,10/h)", async () => {
        const l = await lineaDe("azurerm_kubernetes_cluster", cluster({ sku_tier: "Standard" }));
        expect(l.mensualDespues).toBeCloseTo(3 * 70.08 + 0.1 * 730, 2);
    });

    it("Premium cobra el SLA y avisa que el soporte extendido no entra", async () => {
        const l = await lineaDe("azurerm_kubernetes_cluster", cluster({ sku_tier: "Premium" }));
        expect(l.notas).toContain("lts-no-incluido");
    });

    it("con autoescalado toma el mínimo y lo dice: es un piso", async () => {
        const l = await lineaDe("azurerm_kubernetes_cluster",
            cluster({}, { node_count: null, auto_scaling_enabled: true, min_count: 2, max_count: 10 }));
        expect(l.mensualDespues).toBeCloseTo(2 * 70.08, 2);
        expect(l.notas).toContain("autoescalado-minimo");
    });

    it("un node pool Windows se cobra con licencia", async () => {
        const otros = [{ address: "azurerm_resource_group.rg", type: "azurerm_resource_group",
            change: { actions: ["create"], before: null, after: { location: "westus2" }, after_unknown: {} } }];
        const l = await lineaDe("azurerm_kubernetes_cluster_node_pool", { vm_size: "Standard_D2s_v3", node_count: 2, os_type: "Windows" }, { otros });
        expect(l.mensualDespues).toBeCloseTo(2 * 0.188 * 730, 2);
    });
});

describe("red", () => {
    it("Azure Firewall cobra el despliegue por hora y avisa que los datos procesados no entran", async () => {
        const l = await lineaDe("azurerm_firewall", { location: "westus2", sku_name: "AZFW_VNet", sku_tier: "Standard" });
        expect(l.mensualDespues).toBeCloseTo(1.25 * 730, 2);
        expect(l.notas).toContain("datos-procesados-no-incluidos");
        expect((await lineaDe("azurerm_firewall", { location: "westus2", sku_name: "AZFW_Hub", sku_tier: "Standard" })).motivo).toBe("sin-sku");
    });

    it("Bastion cobra el gateway y avisa de las instancias adicionales", async () => {
        const std = await lineaDe("azurerm_bastion_host", { location: "westus2", sku: "Standard", scale_units: 2 });
        const escalado = await lineaDe("azurerm_bastion_host", { location: "westus2", sku: "Standard", scale_units: 5 });
        expect(std.mensualDespues).toBeCloseTo(0.29 * 730, 2);
        expect(std.notas ?? []).not.toContain("instancias-adicionales-no-incluidas");
        expect(escalado.notas).toContain("instancias-adicionales-no-incluidas");
        expect((await lineaDe("azurerm_bastion_host", { location: "westus2", sku: "Basic" })).mensualDespues).toBeCloseTo(0.19 * 730, 2);
    });

    it("VPN Gateway por SKU; ExpressRoute no se mezcla", async () => {
        expect((await lineaDe("azurerm_virtual_network_gateway", { location: "westus2", sku: "VpnGw1", type: "Vpn" })).mensualDespues)
            .toBeCloseTo(0.19 * 730, 2);
        expect((await lineaDe("azurerm_virtual_network_gateway", { location: "westus2", sku: "Standard", type: "ExpressRoute" })).motivo).toBe("sin-sku");
    });

    it("Application Gateway v2 cobra el costo fijo de su producto (WAF_v2 ≠ Standard_v2)", async () => {
        const waf = await lineaDe("azurerm_application_gateway", { location: "westus2", sku: [{ name: "WAF_v2", tier: "WAF_v2" }] });
        const std = await lineaDe("azurerm_application_gateway", { location: "westus2", sku: [{ name: "Standard_v2", tier: "Standard_v2" }] });
        expect(waf.mensualDespues).toBeCloseTo(0.36 * 730, 2);
        expect(std.mensualDespues).toBeCloseTo(0.2 * 730, 2);
        expect(waf.notas).toContain("unidades-de-capacidad-no-incluidas");
    });

    it("Application Gateway v1 cobra por tamaño y por instancia", async () => {
        const l = await lineaDe("azurerm_application_gateway", { location: "westus2", sku: [{ name: "Standard_Medium", tier: "Standard", capacity: 2 }] });
        expect(l.mensualDespues).toBeCloseTo(0.07 * 730 * 2, 2);
    });

    it("NAT Gateway y Load Balancer se publican como Global, sin región", async () => {
        expect(claveDeConsulta({ serviceName: "NAT Gateway", region: "Global" })).toMatch(/Global/);
        expect((await lineaDe("azurerm_nat_gateway", { location: "westus2", sku_name: "Standard" })).mensualDespues).toBeCloseTo(0.045 * 730, 2);
        expect((await lineaDe("azurerm_lb", { location: "westus2", sku: "Standard" })).mensualDespues).toBeCloseTo(0.025 * 730, 2);
    });

    it("un Load Balancer Basic no se tarifa: está retirado", async () => {
        expect((await lineaDe("azurerm_lb", { location: "westus2", sku: "Basic" })).motivo).toBe("sin-sku");
    });

    it("la IP pública Standard estática cuesta 0,005/h", async () => {
        const l = await lineaDe("azurerm_public_ip", { location: "westus2", sku: "Standard", allocation_method: "Static", ip_version: "IPv4" });
        expect(l.mensualDespues).toBeCloseTo(0.005 * 730, 2);
    });
});

describe("Container Registry", () => {
    it("cobra la unidad diaria del SKU", async () => {
        const l = await lineaDe("azurerm_container_registry", { location: "westus2", sku: "Premium" });
        // 1,6666 USD/día × (730 h / 24 h) días por mes.
        expect(l.mensualDespues).toBeCloseTo(1.6666 * (730 / 24), 2);
    });

    it("cada réplica geográfica de un Premium suma una unidad en SU región", async () => {
        const l = await lineaDe("azurerm_container_registry", { location: "westus2", sku: "Premium", georeplications: [{ location: "eastus" }] });
        expect(l.componentes).toHaveLength(2);
        expect(l.mensualDespues).toBeCloseTo(2 * 1.6666 * (730 / 24), 1);
    });
});

describe("el plan real completo (25 recursos)", () => {
    it("tarifa los 16 tipos que trae el plan, deja el storage como consumo y no tiene fallas mudas", async () => {
        const e = await estimarPlan(PLAN, { precio: precioDeFixture });
        const por = Object.fromEntries(e.lineas.filter((l) => l.mensualDespues > 0).map((l) => [l.tipo, l.mensualDespues]));
        // El catálogo tiene 18 tipos; el plan usa 16 (no trae los scale sets de Windows ni orquestado).
        expect(Object.keys(por)).toHaveLength(16);
        expect(e.sinTarifar).toBe(0);
        expect(e.porUso).toBe(1); // azurerm_storage_account
        expect(e.sinCosto).toBe(8);

        // Cada monto sale del precio de lista de westus2 capturado el 2026-10-08.
        expect(por["azurerm_firewall"]).toBeCloseTo(912.5, 2);
        expect(por["azurerm_application_gateway"]).toBeCloseTo(262.8, 2);
        expect(por["azurerm_bastion_host"]).toBeCloseTo(211.7, 2);
        expect(por["azurerm_linux_virtual_machine_scale_set"]).toBeCloseTo(3 * 140.16, 2);
        expect(por["azurerm_kubernetes_cluster"]).toBeCloseTo(3 * 70.08 + 73, 2);
        expect(por["azurerm_service_plan"]).toBeCloseTo(226.3, 2);
        expect(por["azurerm_redis_cache"]).toBeCloseTo(100.74, 2);
        expect(por["azurerm_virtual_network_gateway"]).toBeCloseTo(138.7, 2);
        expect(por["azurerm_nat_gateway"]).toBeCloseTo(32.85, 2);
        expect(por["azurerm_lb"]).toBeCloseTo(18.25, 2);
        expect(por["azurerm_public_ip"]).toBeCloseTo(3.65, 2);
        // La VM Windows tiene Hybrid Benefit en el plan: cuesta lo mismo que la Linux sin disco.
        expect(por["azurerm_windows_virtual_machine"]).toBeCloseTo(70.08, 2);
    });

    it("todo lo que cobra algo trae el desglose de sus componentes", async () => {
        const e = await estimarPlan(PLAN, { precio: precioDeFixture });
        for (const l of e.lineas.filter((x) => x.mensualDespues > 0)) {
            const suma = (l.componentes ?? []).reduce((t, c) => t + c.mensual, 0);
            expect(suma).toBeCloseTo(l.mensualDespues, 2);
        }
    });

    it("las consultas que hace el catálogo son las que el fixture capturó", () => {
        // Si alguien agrega un mapeo y no captura su respuesta, el test de arriba
        // falla con "el fixture no tiene la consulta": esta lista lo hace legible.
        expect(CONSULTAS_CAPTURADAS.length).toBeGreaterThan(15);
    });
});

describe("utilidades", () => {
    it("normaliza regiones como las escribe Terraform", () => {
        expect(normalizarRegion("West US 2")).toBe("westus2");
        expect(normalizarRegion("westus2")).toBe("westus2");
        expect(normalizarRegion("UK South")).toBe("uksouth");
        expect(normalizarRegion(undefined)).toBe("");
    });

    it("entre medidores equivalentes elige el de vigencia más reciente, no el primero", () => {
        const a = { retailPrice: 1, unitOfMeasure: "1 Hour", effectiveStartDate: "2021-01-01T00:00:00Z" } as ItemRetail;
        const b = { retailPrice: 2, unitOfMeasure: "1 Hour", effectiveStartDate: "2023-01-01T00:00:00Z" } as ItemRetail;
        expect(masReciente([a, b])?.retailPrice).toBe(2);
        expect(masReciente([b, a])?.retailPrice).toBe(2);
    });

    it("ignora un precio con vigencia futura mientras haya uno vigente", () => {
        const hoy = { retailPrice: 1, unitOfMeasure: "1 Hour", effectiveStartDate: "2024-01-01T00:00:00Z" } as ItemRetail;
        const futuro = { retailPrice: 9, unitOfMeasure: "1 Hour", effectiveStartDate: "2099-01-01T00:00:00Z" } as ItemRetail;
        expect(masReciente([futuro, hoy])?.retailPrice).toBe(1);
    });

    it("ningún tipo está a la vez en el catálogo y en las listas de sin costo o por uso", () => {
        for (const t of Object.keys(CATALOGO_TF)) {
            expect(SIN_COSTO.has(t)).toBe(false);
            expect(POR_USO.has(t)).toBe(false);
        }
    });

    it("declara qué atributos lee, para que el script de CI sólo los envíe", () => {
        const { campos, anidados } = camposDelCatalogo();
        for (const c of ["location", "size", "sku", "sku_name", "os_disk", "default_node_pool", "instances"]) {
            expect(campos).toContain(c);
        }
        for (const c of ["storage_account_type", "disk_size_gb", "vm_size", "node_count"]) {
            expect(anidados).toContain(c);
        }
    });
});
