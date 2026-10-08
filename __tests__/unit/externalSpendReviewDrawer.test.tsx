/**
 * Fase 4 de IA (gasto externo): qué se puede rechazar desde la revisión. Un
 * contrato aprobado no: su compromiso seguiría avisando, y se deshace
 * borrando el compromiso.
 */
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";

vi.mock("next-intl", () => ({
    useTranslations: () => (k: string) => k,
    useLocale: () => "es",
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import ReviewDrawer from "@/app/[locale]/intelligence/external-spend/components/ReviewDrawer";
import { mockExternalSpendDocument } from "@/lib/externalSpendMock";
import type { ExternalSpendDocumentDetail, ExternalSpendStatus } from "@/types/externalSpend.types";

const CONTRACT = 104;
const INVOICE = 103;

function drawer(id: number, status: ExternalSpendStatus, canWrite = true) {
    const doc: ExternalSpendDocumentDetail = { ...mockExternalSpendDocument(id)!, status };
    render(
        <ReviewDrawer
            doc={doc} canWrite={canWrite} busy={false} onClose={vi.fn()} onSave={vi.fn()}
            onAction={vi.fn()} onDownload={vi.fn()} onCreateCommitment={vi.fn()}
        />,
    );
    return screen.queryByRole("button", { name: "reject" });
}

describe("ReviewDrawer: rechazar", () => {
    it.each([
        ["una factura pendiente", INVOICE, "needs_review"],
        ["una factura aprobada", INVOICE, "approved"],
        ["un contrato pendiente", CONTRACT, "needs_review"],
    ] as const)("%s se puede rechazar", (_label, id, status) => {
        expect(drawer(id, status)).not.toBeNull();
    });

    it("un contrato aprobado no: se deshace borrando su compromiso", () => {
        expect(drawer(CONTRACT, "approved")).toBeNull();
    });

    it("sin permiso de escritura, nada", () => {
        expect(drawer(INVOICE, "needs_review", false)).toBeNull();
    });
});
