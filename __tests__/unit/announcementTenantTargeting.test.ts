// @vitest-environment node
import { describe, it, expect } from "vitest";
import { isTargetableTenant, type TenantOption } from "@/components/superadmin/SystemAnnouncementsPanel";

const t = (subscriptionStatus: string): TenantOption => ({
    tenantId: "id-1", organizationName: "Acme SA", subscriptionStatus, planTier: "Enterprise",
});

describe("isTargetableTenant — a quién se le puede dirigir un anuncio", () => {
    it("incluye los ACTIVE", () => {
        expect(isTargetableTenant(t("ACTIVE"))).toBe(true);
    });

    // Siguen entrando a la plataforma: excluirlos dejaría sin aviso a usuarios
    // que sí lo verían.
    it("incluye TRIAL y PAST_DUE", () => {
        expect(isTargetableTenant(t("TRIAL"))).toBe(true);
        expect(isTargetableTenant(t("PAST_DUE"))).toBe(true);
    });

    // Un PAST_DUE es justamente a quien se le quiere avisar de la deuda.
    it("excluye sólo los CANCELED, cuyos usuarios ya no entran", () => {
        expect(isTargetableTenant(t("CANCELED"))).toBe(false);
    });

    it("no depende de mayúsculas: el estado llega de la DB sin normalizar", () => {
        expect(isTargetableTenant(t("canceled"))).toBe(false);
    });
});
