// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import {
    leerPlan,
    estimarPlan,
    skuDeDisco,
    accionDe,
    type FuncionPrecio,
} from "@/services/iacCostEstimator.service";

/**
 * MEJ-20. Los fixtures NO están escritos a mano: son la salida de
 * `terraform show -json` de planes reales (Terraform v1.15.8, azurerm 4.x,
 * `format_version: "1.2"`). Si HashiCorp cambia el formato, estos tests
 * describen el que había.
 */
const PLAN = JSON.parse(readFileSync("__tests__/fixtures/terraform-plan-azurerm.json", "utf-8"));

/**
 * Precios fijos por (servicio, sku): acá se prueba la aritmética del plan, no la
 * Retail API ni la elección del medidor (eso lo cubre iacCostCatalog.test.ts).
 */
const TABLA: Record<string, number> = {
    "Virtual Machines|Standard_D2s_v3": 70.08,
    "Storage|P10 LRS": 19.71,
    "Storage|P20 LRS": 76.8,
    "Virtual Network|Standard": 4.38,
};
const precioFalso: FuncionPrecio = async (c) => {
    const k = `${c.consulta.serviceName}|${c.consulta.filtro?.valor ?? ""}`;
    return k in TABLA ? { ok: true, mensual: TABLA[k] } : { ok: false, motivo: "sin-precio" };
};

const recurso = (tipo: string, actions: string[], before: unknown, after: unknown, unknown_?: unknown) => ({
    address: `${tipo}.x`,
    type: tipo,
    change: { actions, before, after, after_unknown: unknown_ ?? {} },
});

describe("skuDeDisco", () => {
    it("mapea el tamaño al tier con el que la Retail API conoce al disco", () => {
        expect(skuDeDisco("Premium_LRS", 128)).toBe("P10 LRS");
        expect(skuDeDisco("StandardSSD_LRS", 128)).toBe("E10 LRS");
        expect(skuDeDisco("Standard_LRS", 128)).toBe("S10 LRS");
        expect(skuDeDisco("Premium_ZRS", 512)).toBe("P20 ZRS");
    });

    it("redondea HACIA ARRIBA, como factura Azure", () => {
        // De la doc: «Azure maps the provisioned size (rounded up) to the
        // nearest offered disk size» — 200 GiB Standard SSD se factura E15 (256),
        // no E10 (128), que es el tier mas CERCANO. Redondear al mas cercano
        // subfacturaria la estimacion justo en los tamaños intermedios, que son
        // los que la gente escribe a mano.
        expect(skuDeDisco("StandardSSD_LRS", 200)).toBe("E15 LRS");
        expect(skuDeDisco("Premium_LRS", 1)).toBe("P1 LRS");
        expect(skuDeDisco("Premium_LRS", 129)).toBe("P15 LRS");
    });

    it("devuelve null para lo que no se cobra por tier", () => {
        // PremiumV2 y Ultra se cobran por GiB/IOPS aprovisionados.
        expect(skuDeDisco("PremiumV2_LRS", 128)).toBeNull();
        expect(skuDeDisco("UltraSSD_LRS", 128)).toBeNull();
        expect(skuDeDisco("Premium_LRS", 0)).toBeNull();
        expect(skuDeDisco("", 128)).toBeNull();
        expect(skuDeDisco("Premium_LRS", 99999)).toBeNull();
    });
});

describe("accionDe", () => {
    it("reconoce el reemplazo en sus dos ordenes", () => {
        // create_before_destroy invierte el orden; las dos son un replace.
        expect(accionDe(["delete", "create"])).toBe("replace");
        expect(accionDe(["create", "delete"])).toBe("replace");
    });

    it("reconoce el resto", () => {
        expect(accionDe(["create"])).toBe("create");
        expect(accionDe(["delete"])).toBe("delete");
        expect(accionDe(["update"])).toBe("update");
        expect(accionDe(["no-op"])).toBe("no-op");
        expect(accionDe([])).toBe("no-op");
        expect(accionDe(undefined)).toBe("no-op");
    });
});

describe("leerPlan sobre un plan real", () => {
    const recursos = leerPlan(PLAN);

    it("lee los 7 cambios del plan", () => {
        expect(recursos).toHaveLength(7);
        expect(recursos.every((r) => r.accion === "create")).toBe(true);
    });

    it("clasifica cada tipo", () => {
        const clase = Object.fromEntries(recursos.map((r) => [r.tipo, r.clase]));
        expect(clase["azurerm_linux_virtual_machine"]).toBe("costo");
        expect(clase["azurerm_managed_disk"]).toBe("costo");
        expect(clase["azurerm_public_ip"]).toBe("costo");
        // Un contador de "sin tarifar" que en realidad son un resource group y una
        // subred hace desconfiar del total entero.
        expect(clase["azurerm_resource_group"]).toBe("sin-costo");
        expect(clase["azurerm_subnet"]).toBe("sin-costo");
        expect(clase["azurerm_virtual_network"]).toBe("sin-costo");
        expect(clase["azurerm_network_interface"]).toBe("sin-costo");
    });
});

describe("estimarPlan", () => {
    it("suma el costo de lo que el plan crea", async () => {
        const e = await estimarPlan(PLAN, { precio: precioFalso });
        // VM 70.08 + disco 19.71 + IP 4.38. El disco del SO de la VM no trae
        // tamaño en este plan, así que no se cobra y se avisa en una nota.
        expect(e.mensualActual).toBe(0);
        expect(e.mensualProyectado).toBeCloseTo(94.17, 2);
        expect(e.delta).toBeCloseTo(94.17, 2);
        expect(e.sinCosto).toBe(4);
        expect(e.sinTarifar).toBe(0);
        expect(e.lineas.find((l) => l.tipo === "azurerm_linux_virtual_machine")?.notas).toContain("disco-os-no-incluido");
    });

    it("un delete resta en vez de sumar", async () => {
        const plan = { resource_changes: [recurso("azurerm_managed_disk", ["delete"],
            { location: "eastus", storage_account_type: "Premium_LRS", disk_size_gb: 128 }, null)] };
        const e = await estimarPlan(plan, { precio: precioFalso });
        expect(e.mensualActual).toBeCloseTo(19.71, 2);
        expect(e.mensualProyectado).toBe(0);
        expect(e.delta).toBeCloseTo(-19.71, 2);
    });

    it("un update cobra el antes y el despues, no sólo el después", async () => {
        const vm = { location: "eastus", size: "Standard_D2s_v3" };
        const e = await estimarPlan({ resource_changes: [recurso("azurerm_linux_virtual_machine", ["update"], vm, vm)] },
            { precio: precioFalso });
        expect(e.delta).toBe(0);
        expect(e.mensualActual).toBeCloseTo(70.08, 2);
    });

    it("un update que cambia el SKU da el delta entre los dos", async () => {
        const e = await estimarPlan({ resource_changes: [recurso("azurerm_managed_disk", ["update"],
            { location: "eastus", storage_account_type: "Premium_LRS", disk_size_gb: 128 },
            { location: "eastus", storage_account_type: "Premium_LRS", disk_size_gb: 512 })] }, { precio: precioFalso });
        expect(e.delta).toBeCloseTo(76.8 - 19.71, 2);
    });

    it("un replace cobra los dos estados", async () => {
        const disco = (gb: number) => ({ location: "eastus", storage_account_type: "Premium_LRS", disk_size_gb: gb });
        const e = await estimarPlan({ resource_changes: [recurso("azurerm_managed_disk", ["delete", "create"], disco(128), disco(512))] },
            { precio: precioFalso });
        expect(e.mensualActual).toBeCloseTo(19.71, 2);
        expect(e.mensualProyectado).toBeCloseTo(76.8, 2);
    });

    it("un no-op no mueve el total", async () => {
        const ip = { location: "eastus", sku: "Standard", allocation_method: "Static" };
        const e = await estimarPlan({ resource_changes: [recurso("azurerm_public_ip", ["no-op"], ip, ip)] }, { precio: precioFalso });
        expect(e.delta).toBe(0);
        expect(e.mensualActual).toBe(0);
        expect(e.sinTarifar).toBe(0);
    });

    it("marca lo que no pudo tarifar en vez de contarlo como gratis", async () => {
        // Un 0 silencioso se suma igual que un recurso sin cargo, y ahi el
        // total miente hacia abajo: el PR parece mas barato de lo que es.
        const plan = { resource_changes: [
            recurso("azurerm_databricks_workspace", ["create"], null, { location: "eastus" }),
            recurso("azurerm_managed_disk", ["create"], null, { location: "eastus", storage_account_type: "UltraSSD_LRS", disk_size_gb: 128 }),
        ] };
        const e = await estimarPlan(plan, { precio: precioFalso });
        expect(e.sinTarifar).toBe(2);
        expect(e.delta).toBe(0);
        expect(e.lineas.map((l) => l.motivo).sort()).toEqual(["sin-sku", "tipo-no-soportado"]);
    });

    it("lo que se cobra por consumo se cuenta aparte de lo que no se pudo tarifar", async () => {
        const plan = { resource_changes: [
            recurso("azurerm_storage_account", ["create"], null, { location: "eastus", account_tier: "Standard" }),
            recurso("azurerm_log_analytics_workspace", ["create"], null, { location: "eastus" }),
            recurso("azurerm_databricks_workspace", ["create"], null, { location: "eastus" }),
        ] };
        const e = await estimarPlan(plan, { precio: precioFalso });
        expect(e.porUso).toBe(2);
        expect(e.sinTarifar).toBe(1);
        expect(e.lineas.filter((l) => l.motivo === "por-uso")).toHaveLength(2);
    });

    it("distingue un medidor que no existe de una API que no contestó", async () => {
        // Un 429 se parece a "no hay precio" pero se resuelve distinto: reintentar
        // más tarde sí sirve. Confundirlos manda a buscar un error de mapeo que no hay.
        const caida: FuncionPrecio = async () => ({ ok: false, motivo: "precio-no-disponible" });
        const disco = { location: "eastus", storage_account_type: "Premium_LRS", disk_size_gb: 128 };
        const e = await estimarPlan({ resource_changes: [recurso("azurerm_managed_disk", ["create"], null, disco)] }, { precio: caida });
        expect(e.lineas[0].motivo).toBe("precio-no-disponible");
        expect(e.sinTarifar).toBe(1);
    });

    it("un medidor con precio 0 es un precio válido (planes gratuitos), no una falla", async () => {
        const gratis: FuncionPrecio = async () => ({ ok: true, mensual: 0 });
        const plan = { resource_changes: [recurso("azurerm_service_plan", ["create"], null,
            { location: "eastus", sku_name: "F1", os_type: "Linux" })] };
        const e = await estimarPlan(plan, { precio: gratis });
        expect(e.sinTarifar).toBe(0);
        expect(e.lineas[0].motivo).toBeUndefined();
    });

    it("un valor que Terraform resuelve recién al aplicar no se confunde con un dato faltante", async () => {
        const plan = { resource_changes: [recurso("azurerm_linux_virtual_machine", ["create"], null,
            { location: "eastus", size: null }, { size: true })] };
        const e = await estimarPlan(plan, { precio: precioFalso });
        expect(e.lineas[0].motivo).toBe("valor-al-aplicar");
    });

    it("la región de un recurso sin location sale del plan sólo si es una sola", async () => {
        const nodePool = recurso("azurerm_kubernetes_cluster_node_pool", ["create"], null, { vm_size: "Standard_D2s_v3", node_count: 2 });
        const rg = (loc: string) => ({ ...recurso("azurerm_resource_group", ["create"], null, { location: loc }), address: `azurerm_resource_group.${loc}` });

        const una = await estimarPlan({ resource_changes: [rg("eastus"), nodePool] }, { precio: precioFalso });
        expect(una.lineas.find((l) => l.tipo === "azurerm_kubernetes_cluster_node_pool")?.region).toBe("eastus");
        expect(una.lineas.find((l) => l.tipo === "azurerm_kubernetes_cluster_node_pool")?.notas).toContain("region-inferida");

        // Con dos regiones no se adivina: sería elegir un precio al azar.
        const dos = await estimarPlan({ resource_changes: [rg("eastus"), rg("westus2"), nodePool] }, { precio: precioFalso });
        expect(dos.lineas.find((l) => l.tipo === "azurerm_kubernetes_cluster_node_pool")?.motivo).toBe("sin-region");
    });

    it("normaliza la región como la escribe Terraform", async () => {
        const consultas: string[] = [];
        const espia: FuncionPrecio = async (c) => { consultas.push(c.consulta.region); return { ok: true, mensual: 1 }; };
        await estimarPlan({ resource_changes: [recurso("azurerm_public_ip", ["create"], null,
            { location: "West US 2", sku: "Standard", allocation_method: "Static" })] }, { precio: espia });
        expect(consultas).toEqual(["westus2"]);
    });

    it("no rompe con basura en la entrada", async () => {
        for (const basura of [null, undefined, {}, { resource_changes: "no-es-un-array" }, []]) {
            const e = await estimarPlan(basura, { precio: precioFalso });
            expect(e.delta).toBe(0);
            expect(e.lineas).toEqual([]);
        }
    });
});

describe("descuento del cliente", () => {
    const disco = { location: "eastus", storage_account_type: "Premium_LRS", disk_size_gb: 128 };
    const plan = { resource_changes: [recurso("azurerm_managed_disk", ["create"], null, disco)] };

    it("aplica el porcentaje y conserva el precio de lista", async () => {
        const e = await estimarPlan(plan, { precio: precioFalso, descuentoPct: 20 });
        expect(e.descuentoPct).toBe(20);
        expect(e.listaDelta).toBeCloseTo(19.71, 2);
        expect(e.delta).toBeCloseTo(19.71 * 0.8, 2);
        expect(e.lineas[0].listaDespues).toBeCloseTo(19.71, 2);
        expect(e.lineas[0].componentes?.[0].mensual).toBeCloseTo(19.71 * 0.8, 2);
    });

    it("sin descuento no agrega campos de lista a las líneas", async () => {
        const e = await estimarPlan(plan, { precio: precioFalso });
        expect(e.descuentoPct).toBe(0);
        expect(e.delta).toBe(e.listaDelta);
        expect(e.lineas[0].listaDespues).toBeUndefined();
    });

    it("el descuento también achica lo que se borra, no sólo lo que se crea", async () => {
        const borrar = { resource_changes: [recurso("azurerm_managed_disk", ["delete"], disco, null)] };
        const e = await estimarPlan(borrar, { precio: precioFalso, descuentoPct: 50 });
        expect(e.delta).toBeCloseTo(-19.71 * 0.5, 2);
    });

    it("acota valores fuera de rango en vez de cobrar negativo o regalar", async () => {
        expect((await estimarPlan(plan, { precio: precioFalso, descuentoPct: 150 })).delta).toBe(0);
        expect((await estimarPlan(plan, { precio: precioFalso, descuentoPct: -30 })).delta).toBeCloseTo(19.71, 2);
        expect((await estimarPlan(plan, { precio: precioFalso, descuentoPct: NaN })).delta).toBeCloseTo(19.71, 2);
    });
});
