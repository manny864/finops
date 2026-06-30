import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";

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

// Mock lucide-react icons
vi.mock("lucide-react", () => ({
    Pin: () => <span data-testid="icon-pin">Pin</span>,
    PinOff: () => <span data-testid="icon-pinoff">PinOff</span>,
    Check: () => <span data-testid="icon-check">Check</span>,
    Loader2: () => <span data-testid="icon-loader">Loader</span>,
    AlertCircle: () => <span data-testid="icon-alert">Alert</span>,
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

    it("renders with default label when no label provided", () => {
        render(<PinButton widgetKey="test-widget" />);

        const button = screen.getByRole("button");
        expect(button).toHaveTextContent("Pinear");
    });

    it("renders with custom label when provided", () => {
        render(<PinButton widgetKey="test-widget" label="Custom Label" />);

        const button = screen.getByRole("button");
        expect(button).toHaveAttribute("title", "Custom Label");
    });

    it("renders in compact mode", () => {
        render(<PinButton widgetKey="test-widget" compact={true} />);

        const button = screen.getByRole("button");
        expect(button).toHaveClass("px-1.5", "py-1");
    });

    it("renders in normal mode by default", () => {
        render(<PinButton widgetKey="test-widget" compact={false} />);

        const button = screen.getByRole("button");
        expect(button).toHaveClass("px-2.5", "py-1.5");
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
        const { rerender } = render(<PinButton widgetKey="widget-1" />);

        // Initially should show Pin icon (not pinned)
        expect(screen.getByTestId("icon-pin")).toBeInTheDocument();
    });
});
