// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

vi.mock("@/lib/requestAuth", () => ({
    AuthError: class AuthError extends Error {},
    requireTenantTier: vi.fn(),
    requireTenantRole: vi.fn(),
}));
vi.mock("@/modules/storage/db", () => ({ default: { query: vi.fn() } }));

import { PUBLIC_API_SCOPES } from "@/types/publicApiKey.types";
import { POST } from "@/app/api/admin/public-api-keys/route";

function archivos(dir: string): string[] {
    return readdirSync(dir).flatMap((n) => {
        const p = join(dir, n);
        return statSync(p).isDirectory() ? archivos(p) : p.endsWith(".ts") ? [p] : [];
    });
}

const alta = (scopes: unknown) =>
    new Request("https://x/api/admin/public-api-keys", {
        method: "POST",
        body: JSON.stringify({ tenantId: "demo-tenant", name: "ci", scopes }),
        headers: { "Content-Type": "application/json" },
    }) as any;

describe("scopes de las API Keys públicas", () => {
    // Es el bug que ya pasó: la ruta exigía write:shift-left y el panel no lo
    // ofrecía, así que ninguna clave creada desde la pantalla servía.
    it("todo scope que una ruta exige con requireScope se puede otorgar", () => {
        const exigidos = new Set<string>();
        for (const f of archivos(join(process.cwd(), "src"))) {
            for (const m of readFileSync(f, "utf8").matchAll(/requireScope\(\s*\w+\s*,\s*["']([^"']+)["']/g)) {
                exigidos.add(m[1]);
            }
        }
        expect(exigidos.size).toBeGreaterThan(0);
        for (const scope of exigidos) expect(PUBLIC_API_SCOPES).toContain(scope);
    });

    it("el alta acepta write:shift-left", async () => {
        const r = await POST(alta(["write:shift-left"]));
        expect(r.status).toBe(201);
        expect((await r.json()).keyItem.scopes).toEqual(["write:shift-left"]);
    });

    it("el alta rechaza un scope que no existe", async () => {
        const r = await POST(alta(["read:cost", "write:todo"]));
        expect(r.status).toBe(400);
        expect((await r.json()).error).toContain("write:todo");
    });
});
