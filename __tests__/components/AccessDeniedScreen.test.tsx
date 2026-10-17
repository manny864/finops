import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";

// El mock lee el catálogo real: si una clave no existe, el test ve la clave cruda en vez del texto y falla, igual que le
// pasaría al usuario.
vi.mock("next-intl", async () => {
    const { readFileSync } = await import("node:fs");
    const es = JSON.parse(readFileSync("messages/es.json", "utf-8"));
    return {
        useLocale: () => "es",
        useTranslations: (ns: string) => (key: string, values?: Record<string, unknown>) => {
            const plantilla: string = es[ns]?.[key] ?? key;
            if (!values) return plantilla;
            return plantilla.replace(/\{(\w+)\}/g, (m, k) => (k in values ? String(values[k]) : m));
        },
    };
});

const logoutRedirect = vi.fn(() => Promise.resolve());
vi.mock("@azure/msal-react", () => ({
    useMsal: () => ({ instance: { logoutRedirect }, accounts: [{ username: "eva@cliente.test", name: "Eva" }] }),
}));
vi.mock("@/components/LanguageSwitcher", () => ({ default: () => <div data-testid="language-switcher" /> }));

import AccessDeniedScreen from "@/components/AccessDeniedScreen";
import { MOTIVOS_DE_ACCESO } from "@/types/accesoTenant.types";

beforeEach(() => logoutRedirect.mockClear());

describe("AccessDeniedScreen (STRIDE-03)", () => {
    it("SIN_CUPO explica el límite con el plan y la cantidad de usuarios", () => {
        render(<AccessDeniedScreen acceso={{ motivo: "SIN_CUPO", tier: "Professional", limite: 3 }} />);
        expect(screen.getByRole("heading", { name: "Tu organización alcanzó el límite de usuarios" })).toBeTruthy();
        expect(screen.getByText(/plan Professional de tu organización admite hasta 3 usuarios/)).toBeTruthy();
    });

    it("DESHABILITADA nombra la cuenta y manda a pedir la reactivación", () => {
        render(<AccessDeniedScreen acceso={{ motivo: "DESHABILITADA" }} />);
        expect(screen.getByRole("heading", { name: "Tu cuenta está deshabilitada" })).toBeTruthy();
        expect(screen.getByText(/deshabilitó el acceso de eva@cliente.test/)).toBeTruthy();
    });

    it("NO_INVITADO dice que falta la activación de un administrador", () => {
        render(<AccessDeniedScreen acceso={{ motivo: "NO_INVITADO" }} />);
        expect(screen.getByRole("heading", { name: "Todavía no tenés acceso" })).toBeTruthy();
        expect(screen.getByText(/fue invitada, pero un administrador todavía no activó su acceso/)).toBeTruthy();
    });

    it.each(["SIN_ACCESO", "SIN_SUSCRIPCION"] as const)("%s usa el mensaje general", (motivo) => {
        render(<AccessDeniedScreen acceso={{ motivo }} />);
        expect(screen.getByRole("heading", { name: "No tenés acceso a esta organización" })).toBeTruthy();
    });

    it("todos los motivos renderizan textos reales, nunca una clave cruda", () => {
        for (const motivo of MOTIVOS_DE_ACCESO) {
            const { container, unmount } = render(<AccessDeniedScreen acceso={{ motivo, tier: "Business", limite: 5 }} onRetry={() => {}} />);
            expect(container.textContent).not.toMatch(/(sinCupo|deshabilitada|noInvitado|sinAcceso)(Title|Body)|btn(Retry|Support|Logout)|^badge$/);
            unmount();
        }
    });

    it("es un alert accesible, con la cuenta autenticada y sin botón de comprar un plan", () => {
        render(<AccessDeniedScreen acceso={{ motivo: "SIN_CUPO", tier: "Professional", limite: 3 }} />);
        expect(screen.getByRole("alert")).toBeTruthy();
        expect(screen.getByText("eva@cliente.test")).toBeTruthy();
        expect(screen.queryByText(/precios|plan(es)? y precios|contratar/i)).toBeNull();
    });

    it("«Volver a intentar» aparece sólo si hay onRetry y lo llama", () => {
        const { rerender } = render(<AccessDeniedScreen acceso={{ motivo: "SIN_ACCESO" }} />);
        expect(screen.queryByRole("button", { name: /Volver a intentar/ })).toBeNull();
        const onRetry = vi.fn();
        rerender(<AccessDeniedScreen acceso={{ motivo: "SIN_ACCESO" }} onRetry={onRetry} />);
        fireEvent.click(screen.getByRole("button", { name: /Volver a intentar/ }));
        expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it("cerrar sesión llama a logoutRedirect volviendo al origen", () => {
        render(<AccessDeniedScreen acceso={{ motivo: "SIN_ACCESO" }} />);
        fireEvent.click(screen.getByRole("button", { name: /Cerrar sesión/ }));
        expect(logoutRedirect).toHaveBeenCalledWith({ postLogoutRedirectUri: window.location.origin });
    });

    it("el enlace a soporte lleva el motivo y la cuenta en el asunto", () => {
        render(<AccessDeniedScreen acceso={{ motivo: "DESHABILITADA" }} />);
        const href = (screen.getByRole("link", { name: /Contactar soporte/ }) as HTMLAnchorElement).getAttribute("href") || "";
        expect(href).toContain("mailto:soporte@cscloudsolutions.com.ar");
        expect(decodeURIComponent(href)).toContain("DESHABILITADA");
        expect(decodeURIComponent(href)).toContain("eva@cliente.test");
    });
});
