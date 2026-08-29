import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/azure", () => ({ getAzureCredential: vi.fn(async () => ({})) }));
vi.mock("@/modules/storage/db", () => ({ default: { query: vi.fn(async () => [[]]) } }));

// vi.hoisted: los mocks deben existir ANTES de que corra el factory de
// vi.mock (que Vitest sube al tope del archivo), y ser los MISMOS objetos que
// usa `remediationService.ts` al instanciar el cliente internamente.
const { getMock, beginUpdateMock } = vi.hoisted(() => ({
    getMock: vi.fn(),
    beginUpdateMock: vi.fn(),
}));

vi.mock("@azure/arm-compute", () => {
    class ComputeManagementClient {
        virtualMachines = { get: getMock, beginUpdate: beginUpdateMock };
    }
    return { ComputeManagementClient };
});

import { downgradeVirtualMachine } from "@/services/remediationService";

beforeEach(() => {
    getMock.mockReset();
    beginUpdateMock.mockReset().mockResolvedValue({});
});

describe("downgradeVirtualMachine — constrained vCPU (Ddsv4/Edsv5)", () => {
    it("resetea vCPUsAvailable al default del tamaño nuevo, conservando vCPUsPerCore", async () => {
        // Standard_D4ds_v4 con vCPUsAvailable explícito: si se arrastra al PATCH,
        // Azure responde "vCPUsAvailable is not supported" para D2ds_v4 (sólo 2 vCPUs).
        // El fix documentado por Azure es enviar vCPUsAvailable=2 (el default de
        // D2ds_v4), no null — null no lo resetea.
        getMock.mockResolvedValue({
            hardwareProfile: { vmSize: "Standard_D4ds_v4", vmSizeProperties: { vCPUsAvailable: 4, vCPUsPerCore: 1 } },
        });

        await downgradeVirtualMachine("tenant-1", "admin@x.com", "sub-1", "rg-1", "vm-1", "Standard_D2ds_v4");

        expect(beginUpdateMock).toHaveBeenCalledWith("rg-1", "vm-1", {
            hardwareProfile: {
                vmSize: "Standard_D2ds_v4",
                vmSizeProperties: { vCPUsPerCore: 1, vCPUsAvailable: 2 },
            },
        });
    });

    it("no toca vmSizeProperties si la VM no tenía vCPUs constreñidas", async () => {
        getMock.mockResolvedValue({ hardwareProfile: { vmSize: "Standard_D4s_v3" } });

        await downgradeVirtualMachine("tenant-1", "admin@x.com", "sub-1", "rg-1", "vm-2", "Standard_D2s_v3");

        expect(beginUpdateMock).toHaveBeenCalledWith("rg-1", "vm-2", {
            hardwareProfile: { vmSize: "Standard_D2s_v3" },
        });
    });
});
