// @vitest-environment node
import { describe, it, expect } from "vitest";
import { resolveParentResourceId, parseArmLeaf, subscriptionIdFromArmId } from "@/lib/armResourceId";

const VM = "/subscriptions/s1/resourceGroups/rg1/providers/Microsoft.Compute/virtualMachines/vm-app-01";

describe("jerarquía de ARM IDs", () => {
    it("una extensión de VM tiene como padre a la VM", () => {
        expect(resolveParentResourceId(`${VM}/extensions/AzureMonitorLinuxAgent`)).toBe(VM);
    });

    it("un recurso de primer nivel no tiene padre", () => {
        // El namespace no es un par tipo/nombre: si se contara como tal, una VM
        // pasaría a "tener padre" y su costo se mostraría como ajeno.
        expect(resolveParentResourceId(VM)).toBeNull();
        expect(resolveParentResourceId("/subscriptions/s1/resourceGroups/rg1/providers/Microsoft.Network/virtualNetworks/vnet-1")).toBeNull();
    });

    it("resuelve un nivel por vez en anidamientos profundos", () => {
        const vnet = "/subscriptions/s1/resourceGroups/rg1/providers/Microsoft.Network/virtualNetworks/vnet-1";
        const subnet = `${vnet}/subnets/snet-app`;
        expect(resolveParentResourceId(subnet)).toBe(vnet);
        expect(resolveParentResourceId(`${subnet}/contextualServiceEndpointPolicies/p1`)).toBe(subnet);
    });

    it("tolera barra final y espacios", () => {
        expect(resolveParentResourceId(`  ${VM}/extensions/ext1/  `)).toBe(VM);
    });

    it("devuelve null ante ids que no son ARM", () => {
        for (const v of ["", "   ", "vm-app-01", "/subscriptions/s1/resourceGroups/rg1"]) {
            expect(resolveParentResourceId(v), v).toBeNull();
        }
    });

    it("un id con pares incompletos no inventa un padre", () => {
        // `.../virtualMachines/vm/extensions` sin nombre: cola par, se descarta.
        expect(resolveParentResourceId(`${VM}/extensions`)).toBeNull();
    });

    it("parseArmLeaf saca nombre y tipo del último par", () => {
        expect(parseArmLeaf(VM)).toEqual({ name: "vm-app-01", type: "virtualMachines" });
        expect(parseArmLeaf(`${VM}/extensions/ext1`)).toEqual({ name: "ext1", type: "extensions" });
        expect(parseArmLeaf("no-es-arm")).toBeNull();
    });

    it("extrae el subscriptionId para poder consultar el costo del padre", () => {
        expect(subscriptionIdFromArmId(VM)).toBe("s1");
        expect(subscriptionIdFromArmId("/SUBSCRIPTIONS/S2/resourceGroups/rg")).toBe("S2");
        expect(subscriptionIdFromArmId("nada")).toBeNull();
    });
});
