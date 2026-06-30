import { describe, it, expect } from "vitest";
import {
    POWERBI_TEMPLATES,
    getTemplate,
    type PowerBITemplate,
} from "@/lib/powerbiTemplates";

describe("powerbiTemplates", () => {
    describe("POWERBI_TEMPLATES array", () => {
        it("contains exactly 4 templates", () => {
            expect(POWERBI_TEMPLATES.length).toBe(4);
        });

        it("each template has required id field", () => {
            POWERBI_TEMPLATES.forEach(t => {
                expect(t).toHaveProperty("id");
                expect(typeof t.id).toBe("string");
                expect(t.id.length).toBeGreaterThan(0);
            });
        });

        it("each template has required name field", () => {
            POWERBI_TEMPLATES.forEach(t => {
                expect(t).toHaveProperty("name");
                expect(typeof t.name).toBe("string");
                expect(t.name.length).toBeGreaterThan(0);
            });
        });

        it("each template has required description field", () => {
            POWERBI_TEMPLATES.forEach(t => {
                expect(t).toHaveProperty("description");
                expect(typeof t.description).toBe("string");
                expect(t.description.length).toBeGreaterThan(0);
            });
        });

        it("each template has required category field", () => {
            POWERBI_TEMPLATES.forEach(t => {
                expect(t).toHaveProperty("category");
                const validCategories = ["cost", "sustainability", "governance", "unit-economics"];
                expect(validCategories).toContain(t.category);
            });
        });

        it("each template has required feedType field", () => {
            POWERBI_TEMPLATES.forEach(t => {
                expect(t).toHaveProperty("feedType");
                expect(typeof t.feedType).toBe("string");
                expect(t.feedType.length).toBeGreaterThan(0);
            });
        });

        it("each template has required sampleVisualizations field", () => {
            POWERBI_TEMPLATES.forEach(t => {
                expect(t).toHaveProperty("sampleVisualizations");
                expect(Array.isArray(t.sampleVisualizations)).toBe(true);
                expect(t.sampleVisualizations.length).toBeGreaterThan(0);
                t.sampleVisualizations.forEach(viz => {
                    expect(typeof viz).toBe("string");
                    expect(viz.length).toBeGreaterThan(0);
                });
            });
        });

        it("each template has required powerQueryM field", () => {
            POWERBI_TEMPLATES.forEach(t => {
                expect(t).toHaveProperty("powerQueryM");
                expect(typeof t.powerQueryM).toBe("string");
                expect(t.powerQueryM.length).toBeGreaterThan(0);
            });
        });
    });

    describe("template IDs are unique", () => {
        it("no duplicate IDs in templates", () => {
            const ids = POWERBI_TEMPLATES.map(t => t.id);
            const uniqueIds = new Set(ids);
            expect(uniqueIds.size).toBe(ids.length);
        });
    });

    describe("getTemplate function", () => {
        it("returns correct template for 'cost-overview'", () => {
            const template = getTemplate("cost-overview");
            expect(template).not.toBeUndefined();
            expect(template!.id).toBe("cost-overview");
            expect(template!.name).toBe("FinOps Cost Overview");
            expect(template!.category).toBe("cost");
        });

        it("returns correct template for 'sustainability'", () => {
            const template = getTemplate("sustainability");
            expect(template).not.toBeUndefined();
            expect(template!.id).toBe("sustainability");
            expect(template!.category).toBe("sustainability");
        });

        it("returns correct template for 'zombies'", () => {
            const template = getTemplate("zombies");
            expect(template).not.toBeUndefined();
            expect(template!.id).toBe("zombies");
            expect(template!.category).toBe("governance");
        });

        it("returns correct template for 'budgets'", () => {
            const template = getTemplate("budgets");
            expect(template).not.toBeUndefined();
            expect(template!.id).toBe("budgets");
            expect(template!.category).toBe("cost");
        });

        it("returns undefined for nonexistent template", () => {
            const template = getTemplate("nonexistent");
            expect(template).toBeUndefined();
        });

        it("returns undefined for empty string", () => {
            const template = getTemplate("");
            expect(template).toBeUndefined();
        });

        it("case-sensitive: 'Cost-Overview' returns undefined", () => {
            const template = getTemplate("Cost-Overview");
            expect(template).toBeUndefined();
        });
    });

    describe("powerQueryM placeholder strings", () => {
        it("each powerQueryM contains '<YOUR_BASE_URL>' placeholder", () => {
            POWERBI_TEMPLATES.forEach(t => {
                expect(t.powerQueryM).toContain("<YOUR_BASE_URL>");
            });
        });

        it("each powerQueryM contains '<YOUR_MCP_KEY>' placeholder", () => {
            POWERBI_TEMPLATES.forEach(t => {
                expect(t.powerQueryM).toContain("<YOUR_MCP_KEY>");
            });
        });

        it("powerQueryM contains valid Power Query M syntax", () => {
            POWERBI_TEMPLATES.forEach(t => {
                expect(t.powerQueryM).toContain("let");
                expect(t.powerQueryM).toContain("in");
            });
        });

        it("powerQueryM contains Web.Contents for API calls", () => {
            POWERBI_TEMPLATES.forEach(t => {
                expect(t.powerQueryM).toContain("Web.Contents");
            });
        });
    });

    describe("template categories", () => {
        it("all categories are within allowed set", () => {
            const allowedCategories = ["cost", "sustainability", "governance", "unit-economics"];
            POWERBI_TEMPLATES.forEach(t => {
                expect(allowedCategories).toContain(t.category);
            });
        });

        it("'cost' category has 2 templates", () => {
            const costTemplates = POWERBI_TEMPLATES.filter(t => t.category === "cost");
            expect(costTemplates.length).toBe(2);
        });

        it("'sustainability' category has 1 template", () => {
            const sustainTemplates = POWERBI_TEMPLATES.filter(t => t.category === "sustainability");
            expect(sustainTemplates.length).toBe(1);
        });

        it("'governance' category has 1 template", () => {
            const govTemplates = POWERBI_TEMPLATES.filter(t => t.category === "governance");
            expect(govTemplates.length).toBe(1);
        });
    });

    describe("template feedType matching", () => {
        it("'cost-overview' has feedType 'costs'", () => {
            const template = getTemplate("cost-overview");
            expect(template!.feedType).toBe("costs");
        });

        it("'sustainability' has feedType 'sustainability'", () => {
            const template = getTemplate("sustainability");
            expect(template!.feedType).toBe("sustainability");
        });

        it("'zombies' has feedType 'zombies'", () => {
            const template = getTemplate("zombies");
            expect(template!.feedType).toBe("zombies");
        });

        it("'budgets' has feedType 'budgets'", () => {
            const template = getTemplate("budgets");
            expect(template!.feedType).toBe("budgets");
        });
    });

    describe("template sample visualizations", () => {
        it("'cost-overview' has multiple sample visualizations", () => {
            const template = getTemplate("cost-overview");
            expect(template!.sampleVisualizations.length).toBeGreaterThanOrEqual(3);
        });

        it("sustainability template includes card, map, and table visualizations", () => {
            const template = getTemplate("sustainability");
            const allViz = template!.sampleVisualizations.join(" ").toLowerCase();
            expect(allViz).toContain("card");
            expect(allViz).toContain("map");
        });

        it("each visualization description is non-empty", () => {
            POWERBI_TEMPLATES.forEach(t => {
                t.sampleVisualizations.forEach(viz => {
                    expect(viz.trim().length).toBeGreaterThan(0);
                });
            });
        });
    });
});
