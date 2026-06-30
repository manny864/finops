import { describe, it, expect } from "vitest";
import { FOCUS_COLUMNS, FOCUS_VERSION, emptyFocusRecord } from "@/lib/focus/columns";
import { mapCostSnapshotToFocus } from "@/lib/focus/mapper";
import {
    buildFocusCsv,
    buildFocusCsvHeader,
    buildFocusCsvRow,
    buildFocusJson,
    buildFocusNdjson,
} from "@/lib/focus/csv";

describe("FOCUS 1.1 — columns", () => {
    it("exposes version 1.1", () => {
        expect(FOCUS_VERSION).toBe("1.1");
    });

    it("declares all FOCUS 1.1 mandatory columns in spec order", () => {
        // Sanity-check a few key mandatory columns + order anchors.
        expect(FOCUS_COLUMNS[0]).toBe("AvailabilityZone");
        expect(FOCUS_COLUMNS).toContain("BilledCost");
        expect(FOCUS_COLUMNS).toContain("EffectiveCost");
        expect(FOCUS_COLUMNS).toContain("ChargeCategory");
        expect(FOCUS_COLUMNS).toContain("BillingPeriodStart");
        expect(FOCUS_COLUMNS).toContain("BillingPeriodEnd");
        expect(FOCUS_COLUMNS).toContain("ProviderName");
        expect(FOCUS_COLUMNS).toContain("ServiceCategory");
        expect(FOCUS_COLUMNS).toContain("Tags");
        expect(FOCUS_COLUMNS).toContain("ServiceSubcategory"); // 1.1 addition
        expect(FOCUS_COLUMNS).toContain("CommitmentDiscountUnit"); // 1.1 addition
        // Ensure no duplicates
        expect(new Set(FOCUS_COLUMNS).size).toBe(FOCUS_COLUMNS.length);
    });

    it("creates an empty record with every column present", () => {
        const r = emptyFocusRecord();
        for (const c of FOCUS_COLUMNS) {
            expect(c in r).toBe(true);
        }
    });
});

describe("FOCUS 1.1 — mapper", () => {
    it("maps a minimal Azure cost row with safe defaults", () => {
        const rec = mapCostSnapshotToFocus({
            tenant_id: "t1",
            subscription_id: "sub-azure-123",
            date: "2026-06-15",
            resource_group: "rg-prod",
            service_name: "Virtual Machines",
            cost_usd: "12.34",
            currency: "USD",
        });

        expect(rec.ProviderName).toBe("Azure");
        expect(rec.PublisherName).toBe("Microsoft");
        expect(rec.BillingCurrency).toBe("USD");
        expect(rec.SubAccountId).toBe("sub-azure-123");
        expect(rec.BillingAccountId).toBe("sub-azure-123");
        expect(rec.BilledCost).toBe(12.34);
        expect(rec.EffectiveCost).toBe(12.34);
        expect(rec.ServiceName).toBe("Virtual Machines");
        expect(rec.ServiceCategory).toBe("Compute");
        expect(rec.ChargeCategory).toBe("Usage");
        expect(rec.ChargeFrequency).toBe("Usage-Based");
        expect(rec.PricingCategory).toBe("Standard");
        expect(rec.Tags).toBe("{}");
        expect(rec.ChargePeriodStart).toMatch(/^2026-06-15/);
        expect(rec.ChargePeriodEnd).toMatch(/^2026-06-15/);
    });

    it("uses explicit FOCUS-shape columns when present", () => {
        const rec = mapCostSnapshotToFocus({
            ChargePeriodStart: "2026-06-01T00:00:00Z",
            ChargePeriodEnd: "2026-06-30T23:59:59Z",
            ProviderName: "AWS",
            PublisherName: "Amazon Web Services",
            SubAccountId: "111122223333",
            BilledCost: "1000.50",
            EffectiveCost: "850.25",
            service_name: "Amazon S3",
            Quantity: 1000,
            UnitOfMeasure: "GB-Mo",
            MeterName: "TimedStorage-ByteHrs",
            MeterCategory: "Storage",
            Tags: { env: "prod", team: "data" },
        });

        expect(rec.ProviderName).toBe("AWS");
        expect(rec.PublisherName).toBe("Amazon Web Services");
        expect(rec.BilledCost).toBe(1000.5);
        expect(rec.EffectiveCost).toBe(850.25);
        expect(rec.ConsumedQuantity).toBe(1000);
        expect(rec.ConsumedUnit).toBe("GB-Mo");
        expect(rec.PricingUnit).toBe("GB-Mo");
        expect(rec.ChargeDescription).toBe("TimedStorage-ByteHrs");
        expect(rec.ResourceType).toBe("Storage");
        expect(rec.ServiceCategory).toBe("Storage");
        expect(rec.ListUnitPrice).toBeCloseTo(1.0005, 4);
        expect(rec.ContractedUnitPrice).toBeCloseTo(0.85025, 4);
        expect(rec.Tags).toBe('{"env":"prod","team":"data"}');
    });

    it("infers ServiceCategory from service name when family missing", () => {
        expect(mapCostSnapshotToFocus({ service_name: "Azure SQL Database" }).ServiceCategory).toBe("Databases");
        expect(mapCostSnapshotToFocus({ service_name: "Bandwidth - VPN egress" }).ServiceCategory).toBe("Networking");
        expect(mapCostSnapshotToFocus({ service_name: "App Service Plan" }).ServiceCategory).toBe("Web");
        expect(mapCostSnapshotToFocus({ service_name: "Azure OpenAI" }).ServiceCategory).toBe("AI and Machine Learning");
        expect(mapCostSnapshotToFocus({ service_name: "Some Unknown Thing" }).ServiceCategory).toBe("Other");
    });

    it("wraps non-JSON tag strings in a raw envelope", () => {
        const rec = mapCostSnapshotToFocus({ Tags: "env=prod;team=core" });
        expect(rec.Tags).toBe('{"raw":"env=prod;team=core"}');
    });

    it("treats empty/invalid dates safely", () => {
        const rec = mapCostSnapshotToFocus({});
        expect(rec.ChargePeriodStart).toBe("");
        expect(rec.ChargePeriodEnd).toBe("");
        expect(rec.SubAccountId).toBe("Unknown");
        expect(rec.ServiceName).toBe("Unallocated");
        expect(rec.BilledCost).toBe(0);
    });
});

describe("FOCUS 1.1 — CSV serialisation", () => {
    it("header matches the canonical column order", () => {
        const h = buildFocusCsvHeader();
        expect(h.split(",")).toEqual([...FOCUS_COLUMNS]);
    });

    it("serialises a record with stable column order", () => {
        const rec = mapCostSnapshotToFocus({
            subscription_id: "sub-1",
            date: "2026-06-15",
            service_name: "Virtual Machines",
            cost_usd: "12.34",
        });
        const row = buildFocusCsvRow(rec);
        const header = buildFocusCsvHeader().split(",");
        const cells = row.split(",");
        expect(cells.length).toBe(header.length);
        // BilledCost is the second column per spec
        expect(cells[header.indexOf("BilledCost")]).toBe("12.34");
        expect(cells[header.indexOf("ProviderName")]).toBe("Azure");
    });

    it("escapes commas, quotes and newlines per RFC 4180", () => {
        const rec = mapCostSnapshotToFocus({
            service_name: 'Weird, "Name"\nthing',
            cost_usd: 1,
        });
        const csv = buildFocusCsv([rec]);
        expect(csv).toContain('"Weird, ""Name""\nthing"');
    });

    it("builds a full CSV with header + N rows", () => {
        const recs = [
            mapCostSnapshotToFocus({ date: "2026-06-01", service_name: "VM", cost_usd: 1 }),
            mapCostSnapshotToFocus({ date: "2026-06-02", service_name: "Storage", cost_usd: 2 }),
        ];
        const csv = buildFocusCsv(recs);
        const lines = csv.split("\n");
        expect(lines.length).toBe(3);
        expect(lines[0]).toBe(buildFocusCsvHeader());
    });

    it("JSON wrapper carries focusVersion", () => {
        const recs = [mapCostSnapshotToFocus({ cost_usd: 1 })];
        const json = JSON.parse(buildFocusJson(recs));
        expect(json.focusVersion).toBe("1.1");
        expect(json.rows.length).toBe(1);
    });

    it("NDJSON is line-delimited JSON without wrapper", () => {
        const recs = [
            mapCostSnapshotToFocus({ cost_usd: 1 }),
            mapCostSnapshotToFocus({ cost_usd: 2 }),
        ];
        const ndjson = buildFocusNdjson(recs);
        const lines = ndjson.split("\n");
        expect(lines.length).toBe(2);
        for (const l of lines) JSON.parse(l); // each must parse standalone
    });
});
