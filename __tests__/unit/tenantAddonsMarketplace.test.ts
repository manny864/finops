import { describe, it, expect } from "vitest";
import { ADDON_CATALOG } from "@/lib/addonCatalog";
import { TenantAddonsService } from "@/services/tenantAddons.service";
import {
    getEffectiveSubscriptionLimit,
    getEffectiveUserLimit,
    hasFeatureOrAddonAccess,
} from "@/lib/tierLogic";

describe("MEJ-13: Marketplace de Add-ons y Capacidades a la Carta", () => {
    it("debe contener todos los add-ons requeridos en ADDON_CATALOG con precios válidos", () => {
        const requiredKeys = [
            "feature_simulator",
            "quota_subscriptions",
            "quota_user_seats",
            "feature_zombies_deep",
            "feature_pdf_reports",
        ];

        for (const key of requiredKeys) {
            const product = ADDON_CATALOG[key];
            expect(product).toBeDefined();
            expect(product.name).toBeTruthy();
            expect(product.category).toMatch(/feature|quota/);
            expect(product.basePriceUSD.monthly).toBeGreaterThan(0);
            expect(product.basePriceUSD.pass1m).toBeGreaterThan(0);
            expect(product.basePriceUSD.pass3m).toBeGreaterThan(product.basePriceUSD.pass1m);
            expect(product.basePriceUSD.pass6m).toBeGreaterThan(product.basePriceUSD.pass3m);
            expect(product.basePriceUSD.pass9m).toBeGreaterThan(product.basePriceUSD.pass6m);
            expect(product.basePriceUSD.pass12m).toBeGreaterThan(product.basePriceUSD.pass9m);
        }
    });

    it("debe obtener los add-ons activos de un tenant demo", async () => {
        const tenantId = "demo-tenant-123";
        const addons = await TenantAddonsService.getActiveAddons(tenantId);
        expect(Array.isArray(addons)).toBe(true);
        expect(addons.length).toBeGreaterThan(0);
        expect(addons[0].status).toBe("active");
    });

    it("debe permitir adquirir un pase temporal de 3 meses para una funcionalidad a la carta", async () => {
        const tenantId = "demo-tenant-test-purchase";
        const purchased = await TenantAddonsService.purchaseAddon(
            tenantId,
            "feature_zombies_deep",
            "pass",
            3
        );

        expect(purchased.addonKey).toBe("feature_zombies_deep");
        expect(purchased.addonType).toBe("pass");
        expect(purchased.status).toBe("active");
        expect(purchased.expiresAt).not.toBeNull();

        const expiresDate = new Date(purchased.expiresAt!);
        const startsDate = new Date(purchased.startsAt);
        const diffDays = Math.round((expiresDate.getTime() - startsDate.getTime()) / (1000 * 3600 * 24));
        expect(diffDays).toBeGreaterThanOrEqual(89); // ~90 días

        // Verificar que aparezca en getActiveAddons
        const active = await TenantAddonsService.getActiveAddons(tenantId);
        const found = active.find((a) => a.addonKey === "feature_zombies_deep");
        expect(found).toBeDefined();
    });

    it("debe permitir adquirir un pase anual de 12 meses", async () => {
        const tenantId = "demo-tenant-test-12m";
        const purchased = await TenantAddonsService.purchaseAddon(
            tenantId,
            "feature_simulator",
            "pass",
            12
        );

        expect(purchased.addonKey).toBe("feature_simulator");
        expect(purchased.addonType).toBe("pass");
        expect(purchased.status).toBe("active");
        expect(purchased.expiresAt).not.toBeNull();

        const expiresDate = new Date(purchased.expiresAt!);
        const startsDate = new Date(purchased.startsAt);
        const diffDays = Math.round((expiresDate.getTime() - startsDate.getTime()) / (1000 * 3600 * 24));
        expect(diffDays).toBeGreaterThanOrEqual(355); // ~360 días
    });

    it("debe verificar acceso a feature considerando el tier base y los add-ons contratados", async () => {
        const tenantId = "demo-tenant-feature-gate";

        // Enterprise tiene acceso nativo sin importar add-ons
        const hasAccessEnt = await TenantAddonsService.hasFeatureOrAddonAccess(
            tenantId,
            "Enterprise",
            "feature_pdf_reports",
            "Enterprise"
        );
        expect(hasAccessEnt).toBe(true);

        // Professional no tiene acceso a feature_pdf_reports inicialmente
        const hasAccessProBefore = await TenantAddonsService.hasFeatureOrAddonAccess(
            tenantId,
            "Professional",
            "feature_pdf_reports",
            "Enterprise"
        );
        expect(hasAccessProBefore).toBe(false);

        // Professional compra el pase temporal
        await TenantAddonsService.purchaseAddon(tenantId, "feature_pdf_reports", "pass", 1);

        // Ahora Professional sí tiene acceso
        const hasAccessProAfter = await TenantAddonsService.hasFeatureOrAddonAccess(
            tenantId,
            "Professional",
            "feature_pdf_reports",
            "Enterprise"
        );
        expect(hasAccessProAfter).toBe(true);
    });

    it("debe calcular cuotas y límites efectivos de suscripciones y asientos de usuarios con add-ons", () => {
        // Professional base: 2 suscripciones, 3 usuarios
        const baseSub = getEffectiveSubscriptionLimit("Professional", 0);
        const baseUsr = getEffectiveUserLimit("Professional", 0);
        expect(baseSub).toBe(2);
        expect(baseUsr).toBe(3);

        // Con +3 suscripciones y +5 asientos extra
        const augmentedSub = getEffectiveSubscriptionLimit("Professional", 3);
        const augmentedUsr = getEffectiveUserLimit("Professional", 5);
        expect(augmentedSub).toBe(5);
        expect(augmentedUsr).toBe(8);

        // Enterprise sigue siendo ilimitado (Infinity)
        expect(getEffectiveSubscriptionLimit("Enterprise", 5)).toBe(Infinity);
        expect(getEffectiveUserLimit("Enterprise", 10)).toBe(Infinity);

        // Helper hasFeatureOrAddonAccess síncrono
        expect(hasFeatureOrAddonAccess("Professional", "Business", false)).toBe(false);
        expect(hasFeatureOrAddonAccess("Professional", "Business", true)).toBe(true);
        expect(hasFeatureOrAddonAccess("Business", "Business", false)).toBe(true);
    });
});
