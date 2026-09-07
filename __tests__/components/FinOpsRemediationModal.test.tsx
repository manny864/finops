import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";

// El modal se abre desde consumo-y-presupuesto y por-categoria. Los comentarios de
// los scripts de Azure CLI / PowerShell / Terraform y el paso a paso salian fijos en
// espanol; este test renderiza el modal con el catalogo EN real y verifica que el
// codigo que el usuario copia venga en su idioma.
vi.mock("next-intl", async (importOriginal) => {
    const actual = (await importOriginal()) as typeof import("next-intl");
    const { readFileSync } = await import("node:fs");
    const en = JSON.parse(readFileSync("messages/en.json", "utf-8"));
    return {
        ...actual,
        useLocale: () => "en",
        useTranslations: (ns: string) =>
            actual.createTranslator({ locale: "en", messages: en, namespace: ns }),
    };
});

vi.mock("@/components/CurrencyProvider", () => ({
    useCurrency: () => ({ format: (n: number) => `$${n.toFixed(2)}` }),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));

import FinOpsRemediationModal from "@/components/dashboard/FinOpsRemediationModal";

const target = {
    resourceName: "vm-prod-01",
    resourceGroup: "rg-prod",
    region: "eastus",
    actionKey: "vm_power_schedule",
    service: "Virtual Machines",
    monthlySavings: 45,
    riskLevel: "low" as const,
};

describe("FinOpsRemediationModal en ingles", () => {
    it("los comentarios del script de Azure CLI vienen en el idioma activo", () => {
        render(<FinOpsRemediationModal isOpen onClose={() => {}} target={target} />);
        const codigo = document.querySelector("pre code")!.textContent!;
        expect(codigo).toContain("Azure CLI: Virtual machine resize / optimization");
        expect(codigo).toContain("Step 1: Stop and deallocate the VM safely");
        expect(codigo).toContain("Step 3: Start the optimized VM");
        expect(codigo).not.toMatch(/Paso \d|Redimensionamiento|Detener/);
        // El comando en si no se traduce
        expect(codigo).toContain('az vm deallocate --resource-group "rg-prod"');
    });

    it("PowerShell y Terraform tambien, incluido el Write-Host", () => {
        render(<FinOpsRemediationModal isOpen onClose={() => {}} target={target} />);
        fireEvent.click(screen.getByText("PowerShell"));
        const ps = document.querySelector("pre code")!.textContent!;
        expect(ps).toContain("Azure PowerShell: Optimization of vm-prod-01");
        expect(ps).toContain("Applying FinOps optimization to $($_.Name)");
        expect(ps).toContain("Remediation completed successfully.");
        expect(ps).not.toMatch(/Aplicando|Autenticar|éxito/);

        fireEvent.click(screen.getByText("Terraform"));
        const tf = document.querySelector("pre code")!.textContent!;
        expect(tf).toContain("Declarative infrastructure adjustment");
        expect(tf).toContain("Cost traceability tags");
        expect(tf).not.toMatch(/Parámetros|trazabilidad/);
    });

    it("el paso a paso, el riesgo y los botones no quedan en espanol", () => {
        render(<FinOpsRemediationModal isOpen onClose={() => {}} target={target} />);
        expect(screen.getByText("FinOps Capacity and Efficiency Optimization")).toBeTruthy();
        expect(screen.getByText("Low")).toBeTruthy();
        expect(screen.getByText("Copy Script")).toBeTruthy();
        expect(screen.getByText("Open in Azure Portal")).toBeTruthy();

        fireEvent.click(screen.getByText("Step by Step (Portal)"));
        const pasos = document.body.textContent!;
        expect(pasos).toContain("rg-prod");
        expect(pasos).not.toMatch(/Paso a Paso|Accede al|Selecciona el recurso/);
    });
});
