import { describe, it, expect, beforeAll, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";

// Mock TenantProvider and MSAL before importing CurrencyProvider
vi.mock("@/components/TenantProvider", () => ({
    useTenant: () => ({ selectedTenant: { id: "default" } }),
    TenantProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("@azure/msal-react", () => ({
    useMsal: () => ({ instance: {}, accounts: [] }),
    MsalProvider: ({ children }: { children: React.ReactNode }) => children,
}));

// Now import CurrencyProvider after mocks are set up
import { useCurrency, CurrencySelector, CurrencyProvider } from "@/components/CurrencyProvider";

// El mock resuelve contra messages/es.json en vez de devolver la clave: asi el
// test sigue afirmando sobre el texto que ve el usuario y, de paso, falla si la
// clave no existe en el catalogo.
vi.mock("next-intl", async () => {
    // El import va DENTRO de la factory: vi.mock se hoistea por encima de los
    // imports del archivo, asi que un readFileSync importado arriba no existe
    // todavia cuando esto corre.
    const { readFileSync } = await import("node:fs");
    const es = JSON.parse(readFileSync("messages/es.json", "utf-8"));
    return {
        useLocale: () => "es",
        useTranslations: (ns: string) => (key: string) => es[ns]?.[key] ?? key,
    };
});


describe("CurrencyProvider", () => {
    describe("useCurrency", () => {
        it("returns USD defaults when not wrapped in CurrencyProvider", () => {
            let result: any;
            
            function Probe() {
                const ctx = useCurrency();
                result = ctx;
                return <div data-testid="probe">{ctx.currency}:{ctx.format(100)}</div>;
            }

            render(<Probe />);
            
            expect(result.currency).toBe("USD");
            expect(result.rate).toBe(1);
            expect(result.supported).toContain("USD");
            expect(result.loading).toBe(false);
            
            const probe = screen.getByTestId("probe");
            expect(probe.textContent).toBe("USD:$100.00");
        });

        it("format function works with fallback values", () => {
            let result: any;
            
            function Probe() {
                const ctx = useCurrency();
                result = ctx;
                return null;
            }

            render(<Probe />);
            
            expect(result.format(50.5)).toBe("$50.50");
            expect(result.format(1000)).toBe("$1000.00");
            expect(result.format("250")).toBe("$250.00");
        });

        it("convert function works with fallback values", () => {
            let result: any;
            
            function Probe() {
                const ctx = useCurrency();
                result = ctx;
                return null;
            }

            render(<Probe />);
            
            expect(result.convert(100)).toBe(100);
            expect(result.convert("50.5")).toBe(50.5);
        });
    });

    describe("CurrencySelector", () => {
        it("renders a select with USD option when standalone", () => {
            render(
                <CurrencyProvider>
                    <CurrencySelector />
                </CurrencyProvider>
            );

            const select = screen.getByRole("combobox");
            expect(select).toBeInTheDocument();
            expect(select).toHaveValue("USD");

            const option = screen.getByRole("option", { name: /USD/ });
            expect(option).toBeInTheDocument();
        });

        it("accepts className prop", () => {
            render(
                <CurrencyProvider>
                    <CurrencySelector className="custom-class" />
                </CurrencyProvider>
            );

            const select = screen.getByRole("combobox");
            expect(select).toHaveClass("custom-class");
        });

        it("renders all supported currencies as options", () => {
            render(
                <CurrencyProvider>
                    <CurrencySelector />
                </CurrencyProvider>
            );

            const options = screen.getAllByRole("option");
            expect(options.length).toBeGreaterThan(0);
            expect(screen.getByRole("option", { name: /USD/ })).toBeInTheDocument();
        });

        it("has title attribute for accessibility", () => {
            render(
                <CurrencyProvider>
                    <CurrencySelector />
                </CurrencyProvider>
            );

            const select = screen.getByRole("combobox");
            expect(select).toHaveAttribute("title", "Divisa de visualización");
        });
    });
});
