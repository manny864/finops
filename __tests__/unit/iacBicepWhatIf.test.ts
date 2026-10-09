// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import {
    estimarPlan,
    estimarWhatIf,
    leerWhatIf,
} from "@/services/iacCostEstimator.service";
import { accionDeCambio, camposArm, tipoDeResourceId } from "@/services/iacCostCatalogArm";
import { precioDeFixture } from "../helpers/retailFixture";

/**
 * Bicep vía el what-if de ARM (MEJ-20).
 *
 * El fixture NO viene de una corrida real: el what-if necesita un grupo de recursos y
 * credenciales en una suscripción. Tiene la forma que documenta Learn ("Deployments -
 * What If", api 2025-04-01) con los nombres de propiedad verificados contra los esquemas
 * ARM oficiales, las definiciones REST del Azure CLI y la referencia de plantillas. Si
 * alguna vez se captura una salida real, conviene reemplazarlo.
 */
const WHATIF = JSON.parse(readFileSync("__tests__/fixtures/arm-whatif-completo.json", "utf8"));
const SUB = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg/providers";
const cambio = (tipo: string, nombre: string, changeType: string, before: unknown, after: unknown) => ({
    resourceId: `${SUB}/${tipo}/${nombre}`, changeType, before, after,
});
const est = (changes: unknown[]) => estimarWhatIf({ changes }, { precio: precioDeFixture });

describe("tipoDeResourceId", () => {
    it("saca el tipo del resourceId, también el de un recurso hijo", () => {
        expect(tipoDeResourceId(`${SUB}/Microsoft.Compute/virtualMachines/vm1`)).toBe("microsoft.compute/virtualmachines");
        expect(tipoDeResourceId(`${SUB}/Microsoft.Network/virtualNetworks/v/subnets/s`)).toBe("microsoft.network/virtualnetworks/subnets");
        expect(tipoDeResourceId("sin-formato")).toBe("");
        expect(tipoDeResourceId(undefined)).toBe("");
    });
});

describe("accionDeCambio", () => {
    it("traduce los siete tipos de cambio de ARM", () => {
        expect(accionDeCambio("Create")).toBe("create");
        expect(accionDeCambio("Delete")).toBe("delete");
        expect(accionDeCambio("Modify")).toBe("update");
        for (const t of ["NoChange", "NoEffect", "Ignore"]) expect(accionDeCambio(t)).toBe("no-op");
        expect(accionDeCambio("Unsupported")).toBe("no-soportado");
        // Sin payload: se trata como update para que salga "sin tarifar" y no desaparezca.
        expect(accionDeCambio("Deploy")).toBe("update");
    });
});

describe("el what-if completo (18 recursos ARM)", () => {
    it("tarifa lo mismo que Terraform para los mismos recursos: comparten las reglas de precio", async () => {
        const e = await estimarWhatIf(WHATIF, { precio: precioDeFixture });
        const por = Object.fromEntries(e.lineas.filter((l) => l.mensualDespues > 0).map((l) => [l.direccion.split("/providers/")[1], l.mensualDespues]));

        expect(por["Microsoft.Network/azureFirewalls/fw"]).toBeCloseTo(912.5, 2);
        expect(por["Microsoft.Network/applicationGateways/agw"]).toBeCloseTo(262.8, 2);
        expect(por["Microsoft.Network/bastionHosts/bastion"]).toBeCloseTo(211.7, 2);
        expect(por["Microsoft.Network/virtualNetworkGateways/vpn"]).toBeCloseTo(138.7, 2);
        expect(por["Microsoft.Network/natGateways/nat"]).toBeCloseTo(32.85, 2);
        expect(por["Microsoft.Network/loadBalancers/lb"]).toBeCloseTo(18.25, 2);
        expect(por["Microsoft.Network/publicIPAddresses/pip"]).toBeCloseTo(3.65, 2);
        expect(por["Microsoft.Cache/redis/redis"]).toBeCloseTo(100.74, 2);
        expect(por["Microsoft.Web/serverfarms/plan"]).toBeCloseTo(226.3, 2);
        expect(por["Microsoft.Compute/disks/disk-datos"]).toBeCloseTo(34.56, 2);
        // VM Linux D2s_v3 (70,08) + disco del SO P6 de 64 GiB.
        expect(por["Microsoft.Compute/virtualMachines/vm-linux"]).toBeCloseTo(79.36, 2);
        // VMSS de Windows con Hybrid Benefit: 2 × D4s_v3 Linux, sin licencia.
        expect(por["Microsoft.Compute/virtualMachineScaleSets/vmss-win"]).toBeCloseTo(2 * 140.16, 2);
        expect(por["Microsoft.ContainerRegistry/registries/acrdemo"]).toBeCloseTo(1.6666 * (730 / 24), 2);
    });

    it("un AKS son varios recursos de costo: el SLA con el primer pool y un recurso por pool adicional", async () => {
        const e = await estimarWhatIf(WHATIF, { precio: precioDeFixture });
        const aks = e.lineas.filter((l) => l.direccion.includes("managedClusters/aks"));
        expect(aks.map((l) => l.direccion.split("managedClusters/")[1])).toEqual(["aks", "aks#pool/user"]);
        expect(aks[0].mensualDespues).toBeCloseTo(3 * 70.08 + 73, 2); // 3 nodos + SLA Standard
        expect(aks[1].mensualDespues).toBeCloseTo(2 * 140.16, 2);
        expect(aks[1].notas).not.toContain("region-inferida"); // en ARM la región sí viene
    });

    it("clasifica sin costo y por consumo, y no deja nada sin tarifar", async () => {
        const e = await estimarWhatIf(WHATIF, { precio: precioDeFixture });
        expect(e.porUso).toBe(1); // storageAccounts
        expect(e.sinCosto).toBe(3); // vnet, nic, web/sites
        expect(e.sinTarifar).toBe(0);
        expect(e.lineas.filter((l) => l.motivo === "por-uso").map((l) => l.direccion)[0]).toMatch(/storageAccounts\/sademo/);
    });

    it("acepta tanto `changes` al tope (CLI) como anidado en `properties` (REST)", async () => {
        const rest = { status: "Succeeded", properties: { changes: WHATIF.changes } };
        expect(leerWhatIf(rest)).toHaveLength(leerWhatIf(WHATIF).length);
        expect((await estimarWhatIf(rest, { precio: precioDeFixture })).delta).toBeCloseTo((await estimarWhatIf(WHATIF, { precio: precioDeFixture })).delta, 4);
    });
});

describe("los tipos de cambio", () => {
    const vm = (size: string) => ({ location: "westus2", properties: { hardwareProfile: { vmSize: size }, storageProfile: { osDisk: { osType: "Linux" } } } });

    it("Modify: el delta es la diferencia entre el antes y el después", async () => {
        const e = await est([cambio("Microsoft.Compute/virtualMachines", "vm", "Modify", vm("Standard_D2s_v3"), vm("Standard_D4s_v3"))]);
        expect(e.mensualActual).toBeCloseTo(70.08, 2);
        expect(e.mensualProyectado).toBeCloseTo(140.16, 2);
        expect(e.delta).toBeCloseTo(70.08, 2);
    });

    it("Delete resta", async () => {
        const e = await est([cambio("Microsoft.Compute/disks", "d", "Delete",
            { location: "westus2", sku: { name: "Premium_LRS" }, properties: { diskSizeGB: 200 } }, null)]);
        expect(e.delta).toBeCloseTo(-34.56, 2);
    });

    it("NoChange, NoEffect e Ignore no mueven el total", async () => {
        for (const t of ["NoChange", "NoEffect", "Ignore"]) {
            const e = await est([cambio("Microsoft.Network/publicIPAddresses", "p", t,
                { location: "westus2", sku: { name: "Standard" }, properties: { publicIPAllocationMethod: "Static" } },
                { location: "westus2", sku: { name: "Standard" }, properties: { publicIPAllocationMethod: "Static" } })]);
            expect(e.delta).toBe(0);
            expect(e.sinTarifar).toBe(0);
        }
    });

    it("Deploy (ResourceIdOnly, sin payload) sale sin tarifar y no desaparece", async () => {
        const e = await est([cambio("Microsoft.Compute/virtualMachines", "vm", "Deploy", undefined, undefined)]);
        expect(e.lineas).toHaveLength(1);
        expect(e.lineas[0].motivo).toBe("sin-sku");
        expect(e.sinTarifar).toBe(1);
    });

    it("Unsupported y los tipos desconocidos quedan como no soportados", async () => {
        const e = await est([
            cambio("Microsoft.Compute/virtualMachines", "vm", "Unsupported", null, null),
            cambio("Microsoft.Databricks/workspaces", "w", "Create", null, { location: "westus2" }),
        ]);
        expect(e.lineas.map((l) => l.motivo)).toEqual(["tipo-no-soportado", "tipo-no-soportado"]);
    });

    it("un node pool que aparece o desaparece en un Modify de AKS se cobra o se resta", async () => {
        const cluster = (pools: unknown[]) => ({ location: "westus2", sku: { tier: "Free" }, properties: { agentPoolProfiles: pools } });
        const sistema = { name: "system", vmSize: "Standard_D2s_v3", count: 3, osType: "Linux" };
        const usuario = { name: "user", vmSize: "Standard_D4s_v3", count: 2, osType: "Linux" };
        const e = await est([cambio("Microsoft.ContainerService/managedClusters", "aks", "Modify", cluster([sistema]), cluster([sistema, usuario]))]);
        expect(e.delta).toBeCloseTo(2 * 140.16, 2);
        const e2 = await est([cambio("Microsoft.ContainerService/managedClusters", "aks", "Modify", cluster([sistema, usuario]), cluster([sistema]))]);
        expect(e2.delta).toBeCloseTo(-2 * 140.16, 2);
    });

    it("traduce el tipo de SO de una VM: Windows paga la licencia salvo Hybrid Benefit", async () => {
        const win = (lic?: string) => ({ location: "westus2", properties: { licenseType: lic, hardwareProfile: { vmSize: "Standard_D2s_v3" }, storageProfile: { osDisk: { osType: "Windows" } } } });
        const sin = await est([cambio("Microsoft.Compute/virtualMachines", "w", "Create", null, win())]);
        const ahb = await est([cambio("Microsoft.Compute/virtualMachines", "w", "Create", null, win("Windows_Server"))]);
        expect(sin.delta).toBeCloseTo(0.188 * 730, 2);
        expect(ahb.delta).toBeCloseTo(0.096 * 730, 2);
    });

    it("el plan de App Service distingue Linux, Windows y contenedores", async () => {
        const plan = (extra: Record<string, unknown>) => ({ location: "westus2", sku: { name: "P1v3", capacity: 1 }, ...extra });
        const linux = await est([cambio("Microsoft.Web/serverfarms", "p", "Create", null, plan({ kind: "linux", properties: { reserved: true } }))]);
        const windows = await est([cambio("Microsoft.Web/serverfarms", "p", "Create", null, plan({ kind: "app", properties: { reserved: false } }))]);
        const contenedor = await est([cambio("Microsoft.Web/serverfarms", "p", "Create", null, plan({ kind: "xenon", properties: { isXenon: true } }))]);
        expect(linux.delta).toBeCloseTo(0.155 * 730, 2);
        expect(windows.delta).toBeCloseTo(0.315 * 730, 2);
        expect(contenedor.lineas[0].motivo).toBe("sin-sku");
    });

    it("no rompe con basura en la entrada", async () => {
        for (const basura of [null, undefined, {}, { changes: "no" }, { changes: [null, {}, { resourceId: 1 }] }]) {
            const e = await estimarWhatIf(basura, { precio: precioDeFixture });
            expect(e.delta).toBe(0);
        }
    });
});

describe("el plan de Terraform sigue igual", () => {
    it("la refactorización del motor no cambió el resultado del plan real", async () => {
        const plan = JSON.parse(readFileSync("__tests__/fixtures/terraform-plan-azurerm-completo.json", "utf8"));
        const e = await estimarPlan(plan, { precio: precioDeFixture });
        expect(e.delta).toBeCloseTo(3176.9149, 2);
    });
});

describe("lo que el script de CI deja salir para Bicep", () => {
    it("camposArm() es la lista de claves que leen los adaptadores, sin duplicados", () => {
        const c = camposArm();
        expect(new Set(c).size).toBe(c.length);
        for (const necesaria of ["location", "sku", "properties", "vmSize", "agentPoolProfiles", "scaleUnits", "gatewayType"]) {
            expect(c).toContain(necesaria);
        }
        // Lo que viaja con una VM y NO se necesita: contraseñas, claves, datos de usuario.
        for (const sensible of ["adminPassword", "customData", "secret", "osProfile", "adminUsername", "redisConfiguration", "servicePrincipalProfile"]) {
            expect(c).not.toContain(sensible);
        }
    });
});
