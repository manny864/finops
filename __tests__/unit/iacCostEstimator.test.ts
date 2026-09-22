// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { leerPlan, estimarPlan, skuDeDisco, accionDe } from "@/services/iacCostEstimator.service";

/**
 * MEJ-20. El fixture NO está escrito a mano: es la salida de
 * `terraform show -json` de un plan real, generado el 2026-09-22 con Terraform
 * v1.15.8 y el provider azurerm 4.x (`format_version: "1.2"`). Si HashiCorp
 * cambia el formato, estos tests describen el que había.
 */
const PLAN = JSON.parse(readFileSync("__tests__/fixtures/terraform-plan-azurerm.json", "utf-8"));

/** Precios fijos: acá se prueba la aritmética del plan, no la Retail API. */
const precioFalso = async (servicio: string, sku: string) => {
    const tabla: Record<string, number> = {
        "Virtual Machines|Standard_D2s_v3": 70.08,
        "Storage|P10 LRS": 19.71,
        "Virtual Network|Standard": 4.38,
    };
    return tabla[`${servicio}|${sku}`] ?? 0;
};

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

    it("extrae el sku de cada tipo con el atributo que le corresponde", () => {
        const porTipo = Object.fromEntries(recursos.map((r) => [r.tipoTerraform, r]));
        expect(porTipo["azurerm_linux_virtual_machine"].skuDespues).toBe("Standard_D2s_v3");
        expect(porTipo["azurerm_managed_disk"].skuDespues).toBe("P10 LRS"); // 128 GiB Premium
        expect(porTipo["azurerm_public_ip"].skuDespues).toBe("Standard");
        expect(porTipo["azurerm_linux_virtual_machine"].region).toBe("eastus");
    });

    it("los recursos sin cargo no se cuentan como 'no tarifados'", () => {
        // Un contador de 4 sin tarifar que en realidad son un resource group y
        // una subred hace desconfiar del total entero.
        const gratis = recursos.filter((r) => !r.serviceName && !r.motivo).map((r) => r.tipoTerraform);
        expect(gratis.sort()).toEqual([
            "azurerm_network_interface",
            "azurerm_resource_group",
            "azurerm_subnet",
            "azurerm_virtual_network",
        ]);
    });
});

describe("estimarPlan", () => {
    it("suma el costo de lo que el plan crea", async () => {
        const e = await estimarPlan(PLAN, precioFalso);
        // VM 70.08 + disco 19.71 + IP 4.38
        expect(e.mensualActual).toBe(0);
        expect(e.mensualProyectado).toBeCloseTo(94.17, 2);
        expect(e.delta).toBeCloseTo(94.17, 2);
        expect(e.sinCosto).toBe(4);
        expect(e.sinTarifar).toBe(0);
    });

    it("un delete resta en vez de sumar", async () => {
        const plan = {
            resource_changes: [{
                address: "azurerm_managed_disk.viejo", type: "azurerm_managed_disk",
                change: {
                    actions: ["delete"],
                    before: { location: "eastus", storage_account_type: "Premium_LRS", disk_size_gb: 128 },
                    after: null,
                },
            }],
        };
        const e = await estimarPlan(plan, precioFalso);
        expect(e.mensualActual).toBeCloseTo(19.71, 2);
        expect(e.mensualProyectado).toBe(0);
        expect(e.delta).toBeCloseTo(-19.71, 2);
    });

    it("un update cobra el antes y el despues, no sólo el después", async () => {
        const plan = {
            resource_changes: [{
                address: "azurerm_linux_virtual_machine.vm", type: "azurerm_linux_virtual_machine",
                change: {
                    actions: ["update"],
                    before: { location: "eastus", size: "Standard_D2s_v3" },
                    after: { location: "eastus", size: "Standard_D2s_v3" },
                },
            }],
        };
        const e = await estimarPlan(plan, precioFalso);
        expect(e.delta).toBe(0);
        expect(e.mensualActual).toBeCloseTo(70.08, 2);
    });

    it("un no-op no mueve el total", async () => {
        const plan = {
            resource_changes: [{
                address: "azurerm_public_ip.ip", type: "azurerm_public_ip",
                change: {
                    actions: ["no-op"],
                    before: { location: "eastus", sku: "Standard" },
                    after: { location: "eastus", sku: "Standard" },
                },
            }],
        };
        const e = await estimarPlan(plan, precioFalso);
        expect(e.delta).toBe(0);
        expect(e.mensualActual).toBe(0);
        expect(e.sinTarifar).toBe(0);
    });

    it("marca lo que no pudo tarifar en vez de contarlo como gratis", async () => {
        // Un 0 silencioso se suma igual que un recurso sin cargo, y ahi el
        // total miente hacia abajo: el PR parece mas barato de lo que es.
        const plan = {
            resource_changes: [
                {
                    address: "azurerm_cosmosdb_account.c", type: "azurerm_cosmosdb_account",
                    change: { actions: ["create"], before: null, after: { location: "eastus" } },
                },
                {
                    address: "azurerm_managed_disk.raro", type: "azurerm_managed_disk",
                    change: {
                        actions: ["create"], before: null,
                        after: { location: "eastus", storage_account_type: "UltraSSD_LRS", disk_size_gb: 128 },
                    },
                },
            ],
        };
        const e = await estimarPlan(plan, precioFalso);
        expect(e.sinTarifar).toBe(2);
        expect(e.delta).toBe(0);
        expect(e.lineas.map((l) => l.motivo).sort()).toEqual(["sin-sku", "tipo-no-soportado"]);
    });

    it("no rompe con basura en la entrada", async () => {
        for (const basura of [null, undefined, {}, { resource_changes: "no-es-un-array" }, []]) {
            const e = await estimarPlan(basura, precioFalso);
            expect(e.delta).toBe(0);
            expect(e.lineas).toEqual([]);
        }
    });
});
