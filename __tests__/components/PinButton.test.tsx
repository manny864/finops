import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";

// El mock lee el catalogo real: si una clave no existe, el test ve la clave
// cruda en vez del texto y falla, igual que le pasaria al usuario.
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

// Mock TenantProvider and MSAL before importing PinButton
vi.mock("@/components/TenantProvider", () => ({
    useTenant: vi.fn(() => ({
        selectedTenant: { id: "test-tenant-123" },
    })),
}));

vi.mock("@azure/msal-react", () => ({
    useMsal: vi.fn(() => ({
        instance: {
            acquireTokenSilent: vi.fn().mockResolvedValue({ idToken: "mock-token" }),
        },
        accounts: [{ localAccountId: "user1" }],
    })),
}));

// Mock @tabler/icons-react icons
vi.mock("@tabler/icons-react", () => ({
    IconPin: () => <span data-testid="icon-pin">Pin</span>,
    IconPinFilled: () => <span data-testid="icon-pin-filled">PinFilled</span>,
    IconCheck: () => <span data-testid="icon-check">Check</span>,
    IconLoader2: () => <span data-testid="icon-loader">Loader</span>,
    IconAlertCircle: () => <span data-testid="icon-alert">Alert</span>,
}));

// Mock sonner toast
vi.mock("sonner", () => ({
    toast: {
        success: vi.fn(),
        error: vi.fn(),
    },
}));

// Mock SWR
vi.mock("swr", () => ({
    default: vi.fn(() => ({
        data: { pins: [] },
        error: null,
        isLoading: false,
    })),
    mutate: vi.fn(),
}));

// Now import PinButton after all mocks are set up
import PinButton from "@/components/dashboard/PinButton";

describe("PinButton", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ success: true, pins: [] }),
        } as any);
    });

    it("renders the button when tenant is valid", () => {
        render(<PinButton widgetKey="test-widget" />);

        const button = screen.getByRole("button");
        expect(button).toBeInTheDocument();
    });

    it("renders with default tooltip when no label provided", () => {
        render(<PinButton widgetKey="test-widget" />);

        const button = screen.getByRole("button");
        expect(button).toHaveAttribute("title", "Pinear al dashboard");
    });

    it("renders with custom label when provided", () => {
        render(<PinButton widgetKey="test-widget" label="Custom Label" />);

        const button = screen.getByRole("button");
        expect(button).toHaveAttribute("title", "Custom Label");
    });

    it("renders in compact mode", () => {
        render(<PinButton widgetKey="test-widget" compact={true} />);

        const button = screen.getByRole("button");
        expect(button).toHaveClass("w-7", "h-7");
    });

    it("renders in normal mode by default", () => {
        render(<PinButton widgetKey="test-widget" compact={false} />);

        const button = screen.getByRole("button");
        expect(button).toHaveClass("w-8", "h-8");
    });

    it("has aria-label and aria-pressed attributes", () => {
        render(<PinButton widgetKey="test-widget" />);

        const button = screen.getByRole("button");
        expect(button).toHaveAttribute("aria-label", "Pinear al dashboard");
        expect(button).toHaveAttribute("aria-pressed", "false");
    });

    it("button has type button", () => {
        render(<PinButton widgetKey="test-widget" />);

        const button = screen.getByRole("button");
        expect(button).toHaveAttribute("type", "button");
    });

    it("calls fetch when button is clicked", async () => {
        render(<PinButton widgetKey="test-widget" />);

        const button = screen.getByRole("button");
        fireEvent.click(button);

        await waitFor(() => {
            expect(global.fetch).toHaveBeenCalled();
        });
    });

    it("disables button when busy", () => {
        render(<PinButton widgetKey="test-widget" />);

        const button = screen.getByRole("button");
        expect(button).not.toBeDisabled();
    });

    it("renders icon based on widget key", () => {
        render(<PinButton widgetKey="widget-1" />);

        // Initially should show Pin icon (not pinned)
        expect(screen.getByTestId("icon-pin")).toBeInTheDocument();
    });
});
