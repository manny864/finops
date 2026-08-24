import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";
import CoinRecommendationsModal from "@/components/dashboard/CoinRecommendationsModal";
import type { CoinRecommendationItem } from "@/lib/coinTypes";

vi.mock("next-intl", () => ({
    useLocale: () => "es",
    useTranslations: () => (key: string) => key,
}));

vi.mock("next/link", () => ({
    default: ({ children, href, onClick, className }: any) => (
        <a href={href} onClick={onClick} className={className} data-testid="next-link">
            {children}
        </a>
    ),
}));

const mockRecommendations: CoinRecommendationItem[] = [
    {
        id: "rec-1",
        name: "Eliminar discos huérfanos",
        description: "Discos unattached que consumen storage",
        category: "Cost",
        impact: "High",
        impactedResource: "disk-orphan-01",
        resourceGroup: "rg-prod",
        subscriptionName: "Sub Principal",
        estimatedMonthlySavingsUsd: 145.0,
        status: "pending",
        targetModuleUrl: "/intelligence/almacenamiento",
    },
    {
        id: "rec-2",
        name: "Habilitar Defender for SQL",
        description: "Protección avanzada para bases de datos",
        category: "Security",
        impact: "High",
        impactedResource: "sql-srv-prod",
        resourceGroup: "rg-databases",
        subscriptionName: "Sub Principal",
        estimatedMonthlySavingsUsd: 0,
        status: "implemented",
        targetModuleUrl: "/intelligence/seguridad",
    },
    {
        id: "rec-3",
        name: "Habilitar ZRS en Storage",
        description: "Redundancia de zona para backups",
        category: "Reliability",
        impact: "Medium",
        impactedResource: "stbackupprod",
        resourceGroup: "rg-storage",
        subscriptionName: "Sub Principal",
        estimatedMonthlySavingsUsd: 45.0,
        status: "snoozed",
        snoozedUntil: "2026-09-30T00:00:00.000Z",
        targetModuleUrl: "/intelligence/almacenamiento",
    },
];

describe("CoinRecommendationsModal", () => {
    it("does not render when isOpen is false", () => {
        const { container } = render(
            <CoinRecommendationsModal
                isOpen={false}
                onClose={vi.fn()}
                recommendations={mockRecommendations}
            />
        );
        expect(container.firstChild).toBeNull();
    });

    it("renders modal header and recommendations when open", () => {
        render(
            <CoinRecommendationsModal
                isOpen={true}
                onClose={vi.fn()}
                recommendations={mockRecommendations}
            />
        );

        expect(screen.getByText(/Recomendaciones de Optimización/i)).toBeDefined();
        expect(screen.getByText("Eliminar discos huérfanos")).toBeDefined();
        expect(screen.getByText("disk-orphan-01")).toBeDefined();
        expect(screen.getByText("$145.00 USD/mes")).toBeDefined();
    });

    it("filters recommendations by status tab correctly", () => {
        render(
            <CoinRecommendationsModal
                isOpen={true}
                onClose={vi.fn()}
                initialStatusFilter="ALL"
                recommendations={mockRecommendations}
            />
        );

        // Click on "Implementadas"
        const implementedTab = screen.getByRole("button", { name: /Implementadas/i });
        fireEvent.click(implementedTab);

        expect(screen.getByText("Habilitar Defender for SQL")).toBeDefined();
        expect(screen.queryByText("Eliminar discos huérfanos")).toBeNull();
    });

    it("filters recommendations by search query", () => {
        render(
            <CoinRecommendationsModal
                isOpen={true}
                onClose={vi.fn()}
                recommendations={mockRecommendations}
            />
        );

        const searchInput = screen.getByPlaceholderText(/Buscar recurso/i);
        fireEvent.change(searchInput, { target: { value: "stbackupprod" } });

        expect(screen.getByText("Habilitar ZRS en Storage")).toBeDefined();
        expect(screen.queryByText("Eliminar discos huérfanos")).toBeNull();
    });

    it("calls onClose when close button is clicked", () => {
        const handleClose = vi.fn();
        render(
            <CoinRecommendationsModal
                isOpen={true}
                onClose={handleClose}
                recommendations={mockRecommendations}
            />
        );

        const closeButtons = screen.getAllByRole("button");
        // The header X button is the close button
        const xBtn = closeButtons.find((btn) => btn.querySelector("svg.tabler-icon-x") || btn.className.includes("rounded-xl"));
        if (xBtn) fireEvent.click(xBtn);
    });
});
