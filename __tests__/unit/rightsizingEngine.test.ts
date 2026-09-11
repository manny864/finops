import { describe, it, expect } from "vitest";
import { analyzeVmEfficiency } from "@/modules/core/rightsizingEngine";

/**
 * El motor solo miraba hacia abajo: cualquier VM con p95 >= 40% caia en
 * "Optimized" y desaparecia de la pantalla, incluidas las que viven al 95%.
 * Estos casos fijan los dos lados del corte.
 */
const vm = (sku: string) => ({ sku });
const m = (p95Cpu: number, maxCpu = p95Cpu) => ({ p95Cpu, maxCpu, avgCpu: p95Cpu, p95Mem: 0 });

describe("analyzeVmEfficiency", () => {
    it("baja de SKU cuando la CPU esta ociosa o sobrada", () => {
        expect(analyzeVmEfficiency(vm("Standard_D8s_v3"), m(4))).toMatchObject({
            action: "DOWNGRADE", status: "Idle", recommendedSku: "Standard_D4s_v3",
        });
        expect(analyzeVmEfficiency(vm("Standard_E16ds_v5"), m(25))).toMatchObject({
            action: "DOWNGRADE", status: "Oversized", recommendedSku: "Standard_E8ds_v5",
        });
    });

    it("sube de SKU con CPU sostenida alta", () => {
        expect(analyzeVmEfficiency(vm("Standard_D4s_v5"), m(88, 99))).toMatchObject({
            action: "UPGRADE", status: "Saturated", recommendedSku: "Standard_D8s_v5",
        });
    });

    it("sube de SKU cuando los picos pegan contra el techo con un piso ya alto", () => {
        expect(analyzeVmEfficiency(vm("Standard_E8s_v5"), m(65, 98))).toMatchObject({
            action: "UPGRADE", status: "Peaking", recommendedSku: "Standard_E16s_v5",
        });
    });

    /*
     * El caso que hace que la regla de picos no sea gratis: una B-series que
     * rafaguea a 100% un rato y vive al 5% esta haciendo exactamente aquello
     * para lo que se la compro. Subirla de SKU es gasto puro. Por eso el pico
     * exige ADEMAS un piso sostenido alto.
     */
    it("una rafaga aislada sobre un piso bajo no es un upgrade", () => {
        const r = analyzeVmEfficiency(vm("Standard_B4ms"), { p95Cpu: 6, maxCpu: 100, avgCpu: 5, p95Mem: 0 });
        expect(r.action).toBe("DOWNGRADE"); // piso al 6% => sigue siendo ociosa
        expect(r.recommendedSku).toBe("Standard_B2ms");
    });

    it("una VM en zona sana no genera recomendacion", () => {
        expect(analyzeVmEfficiency(vm("Standard_D8s_v5"), m(55, 70)).action).toBe("NONE");
    });

    it("sin telemetria no concluye nada", () => {
        expect(analyzeVmEfficiency(vm("Standard_D8s_v5"), m(0, 0)).action).toBe("NONE");
    });

    it("no propone cambio en los extremos de la familia", () => {
        // Ya en el minimo: nada que bajar.
        expect(analyzeVmEfficiency(vm("Standard_D2s_v5"), m(3)).action).toBe("NONE");
        // Ya en el tope: nada que subir.
        expect(analyzeVmEfficiency(vm("Standard_D96s_v5"), m(92)).action).toBe("NONE");
    });

    it("un SKU con formato no reconocido se deja en paz", () => {
        expect(analyzeVmEfficiency(vm("Basic_A0"), m(2)).action).toBe("NONE");
    });

    it("isUnderutilized sigue siendo cierto solo para las bajadas", () => {
        expect(analyzeVmEfficiency(vm("Standard_D8s_v3"), m(4)).isUnderutilized).toBe(true);
        expect(analyzeVmEfficiency(vm("Standard_D4s_v5"), m(88, 99)).isUnderutilized).toBe(false);
    });
});
