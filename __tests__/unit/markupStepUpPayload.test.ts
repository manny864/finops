import { describe, expect, it } from "vitest";
import { hashPayload } from "@/lib/mfaCrypto";
import { markupStepUpPayload } from "@/types/tenantPartnerMarkup.types";
import { cancellationStepUpPayload, planChangeStepUpPayload, type SubscriptionPlanChange } from "@/types/saasBilling.types";

const settings = { globalMarkupPercentage: 15, fixedManagementFeeUSD: 500, isMarkupEnabled: true };
describe("markup step-up payload", () => {
    it("projects every sensitive field in stable order independently of input property order", () => {
        const a = markupStepUpPayload("tenant-a", settings);
        const b = markupStepUpPayload("tenant-a", {
            isMarkupEnabled: true, fixedManagementFeeUSD: 500, globalMarkupPercentage: 15,
        });

        expect(a).toEqual({ action: "save_partner_markup", tenantId: "tenant-a", ...settings });
        expect(JSON.stringify(a)).toBe(JSON.stringify(b));
        expect(hashPayload(a)).toBe(hashPayload(b));
    });
    it.each([
        { globalMarkupPercentage: 16 },
        { fixedManagementFeeUSD: 501 },
        { isMarkupEnabled: false },
    ])("changing a sensitive value changes the server hash: %j", (changed) => {
        expect(hashPayload(markupStepUpPayload("tenant-a", { ...settings, ...changed })))
            .not.toBe(hashPayload(markupStepUpPayload("tenant-a", settings)));
    });
    it("separates targets and rejects the old tenant-only binding", () => {
        const hash = hashPayload(markupStepUpPayload("tenant-a", settings));
        expect(hashPayload(markupStepUpPayload("tenant-b", settings))).not.toBe(hash);
        expect(hashPayload({ tenantId: "tenant-a" })).not.toBe(hash);
    });
});

describe("subscription step-up payload", () => {
    const change: SubscriptionPlanChange = {
        newTier: "Business", billing: "monthly", prorationBillingMode: "prorated_immediately",
    };
    it("normalizes property order for the complete plan change", () => {
        const reordered: SubscriptionPlanChange = {
            prorationBillingMode: "prorated_immediately", billing: "monthly", newTier: "Business",
        };
        expect(hashPayload(planChangeStepUpPayload("a", reordered)))
            .toBe(hashPayload(planChangeStepUpPayload("a", change)));
    });
    it.each<Partial<SubscriptionPlanChange>>([
        { newTier: "Professional" }, { billing: "yearly" }, { prorationBillingMode: "do_not_bill" },
    ])("binds all plan fields: %j", (changed) => {
        expect(hashPayload(planChangeStepUpPayload("a", { ...change, ...changed })))
            .not.toBe(hashPayload(planChangeStepUpPayload("a", change)));
    });
    it("binds cancellation timing and separates target tenants and operations", () => {
        const hash = hashPayload(cancellationStepUpPayload("a", "immediately"));
        expect(hashPayload(cancellationStepUpPayload("a", "next_billing_period"))).not.toBe(hash);
        expect(hashPayload(cancellationStepUpPayload("b", "immediately"))).not.toBe(hash);
        expect(hashPayload(planChangeStepUpPayload("a", change))).not.toBe(hash);
    });
});
