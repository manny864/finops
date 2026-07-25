import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";

const DICTIONARY: Record<string, string> = {
    "Simulator.computeLabel": "Crecimiento de Cómputo (VMs/AKS)",
    "Simulator.computeLabel_aws": "Crecimiento de Cómputo (EC2/EKS)",
    "Simulator.runButton": "Ejecutar Simulación",
};

let activeProvider = "azure";

vi.mock("next-intl", () => ({
    useTranslations: (namespace: string) => {
        const t = ((key: string) => DICTIONARY[`${namespace}.${key}`] ?? `${namespace}.${key}`) as any;
        t.has = (key: string) => `${namespace}.${key}` in DICTIONARY;
        t.raw = (key: string) => DICTIONARY[`${namespace}.${key}`];
        t.rich = (key: string) => `rich:${DICTIONARY[`${namespace}.${key}`]}`;
        t.markup = (key: string) => `markup:${DICTIONARY[`${namespace}.${key}`]}`;
        return t;
    },
}));

vi.mock("@/context/ProviderContext", () => ({
    useCloudProvider: () => ({ activeProvider }),
}));

import { useProviderTranslations } from "@/lib/useProviderTranslations";

function Probe({ tkey }: { tkey: string }) {
    const t = useProviderTranslations("Simulator");
    return <div data-testid="out">{t(tkey)}</div>;
}

describe("useProviderTranslations", () => {
    it("usa la terminología de Azure cuando el proveedor activo es Azure", () => {
        activeProvider = "azure";
        render(<Probe tkey="computeLabel" />);
        expect(screen.getByTestId("out").textContent).toBe("Crecimiento de Cómputo (VMs/AKS)");
    });

    it("usa la terminología de AWS cuando el proveedor activo es AWS", () => {
        activeProvider = "aws";
        render(<Probe tkey="computeLabel" />);
        // Regresión concreta: AKS no existe en AWS.
        expect(screen.getByTestId("out").textContent).toBe("Crecimiento de Cómputo (EC2/EKS)");
        expect(screen.getByTestId("out").textContent).not.toContain("AKS");
    });

    it("cae a la clave base en AWS cuando no hay variante específica", () => {
        activeProvider = "aws";
        render(<Probe tkey="runButton" />);
        expect(screen.getByTestId("out").textContent).toBe("Ejecutar Simulación");
    });

    it("no rompe con una clave inexistente", () => {
        activeProvider = "aws";
        render(<Probe tkey="noExiste" />);
        expect(screen.getByTestId("out").textContent).toBe("Simulator.noExiste");
    });

    it("preserva rich, markup y raw del contrato de next-intl", () => {
        activeProvider = "aws";
        let api: any;
        function ApiProbe() {
            api = useProviderTranslations("Simulator");
            return null;
        }
        render(<ApiProbe />);
        expect(typeof api.rich).toBe("function");
        expect(typeof api.markup).toBe("function");
        expect(typeof api.raw).toBe("function");
        expect(typeof api.has).toBe("function");
        // También resuelven la variante AWS, no sólo la llamada directa.
        expect(api.raw("computeLabel")).toBe("Crecimiento de Cómputo (EC2/EKS)");
        expect(api.rich("computeLabel")).toContain("EC2/EKS");
        expect(api.markup("computeLabel")).toContain("EC2/EKS");
    });
});
