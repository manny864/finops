// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const queryMock = vi.fn();
vi.mock("@/modules/storage/db", () => ({
    default: { query: (...a: unknown[]) => queryMock(...a) },
    initializeDatabase: vi.fn(async () => {}),
}));
vi.mock("@/lib/mockData", () => ({ isMockTenant: (t: string) => t === "demo_tenant" }));

import { getTenantNotifications } from "@/services/tenantNotifications.service";
import { createNotification } from "@/lib/notify";

beforeEach(() => queryMock.mockReset().mockResolvedValue([[]]));

/** Todos los SQL que ejecutó la llamada. */
const sqls = () => queryMock.mock.calls.map((c) => String(c[0]));

describe("createNotification — MEJ-33 paso 3", () => {
    it("sin userEmail escribe null: difusión a todo el tenant", async () => {
        queryMock.mockResolvedValue([{}]);
        await createNotification({ tenantId: "t1", title: "x", message: "y", source: "s" });
        expect(queryMock.mock.calls[0][1]).toContain(null);
    });

    it("con userEmail dirige el aviso", async () => {
        queryMock.mockResolvedValue([{}]);
        await createNotification({ tenantId: "t1", title: "x", message: "y", source: "s", userEmail: "ana@x.com" });
        expect(queryMock.mock.calls[0][1]).toContain("ana@x.com");
    });
});

describe("getTenantNotifications — aislamiento entre usuarios", () => {
    // El riesgo de esta feature: filtrar mal muestra el aviso de otra persona.
    it("con identidad trae difusión + lo dirigido a esa persona", async () => {
        await getTenantNotifications("t1", 20, false, "ana@x.com");
        expect(sqls().some((q) => q.includes("user_email IS NULL OR user_email = ?"))).toBe(true);
        // el email viaja como parámetro, no interpolado
        expect(queryMock.mock.calls.some((c) => (c[1] as unknown[])?.includes("ana@x.com"))).toBe(true);
    });

    // Opción segura: sin saber quién pregunta, mejor ocultar un aviso dirigido
    // que mostrarle a alguien el de otro.
    it("SIN identidad cae a sólo difusión", async () => {
        await getTenantNotifications("t1", 20, false, null);
        const q = sqls();
        expect(q.some((x) => x.includes("user_email IS NULL"))).toBe(true);
        expect(q.some((x) => x.includes("user_email = ?"))).toBe(false);
    });

    // Si el conteo y el listado usaran predicados distintos, el badge mostraría
    // un número que no se corresponde con la lista.
    it("el conteo y el listado usan el MISMO predicado de destinatario", async () => {
        await getTenantNotifications("t1", 20, false, "ana@x.com");
        const conDestinatario = sqls().filter((q) => q.includes("FROM Notifications"));
        expect(conDestinatario.length).toBeGreaterThanOrEqual(2);
        for (const q of conDestinatario) {
            expect(q, q).toContain("user_email");
        }
    });

    it("unreadOnly conserva el filtro de destinatario", async () => {
        await getTenantNotifications("t1", 20, true, "ana@x.com");
        const listado = sqls().find((q) => q.includes("SELECT * FROM Notifications"));
        expect(listado).toContain("user_email");
        expect(listado).toContain("is_read");
    });
});
