// @vitest-environment node
/**
 * MEJ-35 — qué sale del envío, y qué NO sale.
 *
 * La cadencia tiene sus tests aparte. Acá van los otros tres criterios: que el
 * correo traiga las tres cosas, que el alcance se respete, y que una
 * suscripción de alguien dado de baja deje de mandar.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// El cron exige un CRON_SECRET de al menos 16 caracteres; se fija acá y no se
// hereda del entorno, para que el test valga lo mismo en CI que local.
process.env.CRON_SECRET = "un-secreto-suficientemente-largo";

const { queryMock, mailMock, filasMock, listarMock } = vi.hoisted(() => ({
    queryMock: vi.fn(),
    mailMock: vi.fn(async () => {}),
    filasMock: vi.fn(),
    listarMock: vi.fn(),
}));

vi.mock("@/modules/storage/db", () => ({
    default: { query: queryMock },
    initializeDatabase: vi.fn(async () => {}),
}));
vi.mock("@/lib/emailHelper", () => ({ sendEmailStrict: mailMock }));
vi.mock("@/services/perspectivesData.service", () => ({
    filasDeCosto: filasMock,
    listarPerspectivas: listarMock,
}));
vi.mock("@/lib/cronRunTracker", () => ({ recordCronRun: vi.fn(async () => {}) }));

import { enviarSuscripcion } from "@/services/reportDispatch.service";

/** Una fila de costo con las dimensiones que las reglas miran. */
const fila = (rg: string, costo: number) => ({
    subscriptionId: "s1", resourceGroup: rg, serviceName: "X", resourceId: `/x/${rg}`, tags: null, costo,
});

const REGLAS = [
    { grupo: "Datos", tipo: "resource_group", clave: null, valor: "rg-datos", orden: 0 },
    { grupo: "Web", tipo: "resource_group", clave: null, valor: "rg-web", orden: 1 },
];

beforeEach(() => {
    queryMock.mockReset().mockImplementation(async (sql: string) => {
        if (sql.includes("SELECT created_by FROM ReportSubscriptions")) return [[{ created_by: null }]];
        return sql.includes("FROM Tenants") ? [[{ company_name: "Acme" }]] : [[]];
    });
    mailMock.mockReset().mockResolvedValue(undefined);
    listarMock.mockReset().mockResolvedValue([{ id: 7, name: "Equipos", reglas: REGLAS }]);
    filasMock.mockReset().mockResolvedValue([fila("rg-datos", 1000), fila("rg-web", 400)]);
});

const sub = (scope: any = null) => ({
    id: 1, tenantId: "t1", reportType: "gasto-por-equipo", scope, recipients: ["a@a.com"],
});

describe("criterio 2 — el correo trae link, gráfico y CSV", () => {
    it("las tres cosas", async () => {
        await enviarSuscripcion(sub(), { marcarEnviado: false });
        const [asunto, html, destinatario, adjuntos] = mailMock.mock.calls[0] as any;

        expect(asunto).toContain("Acme");
        expect(destinatario).toBe("a@a.com");
        // Link al tablero vivo.
        expect(html).toMatch(/href="[^"]*\/intelligence\/cost-groups\?perspective=7/);
        // El gráfico: barras con celdas de tabla, que es lo que Gmail y Outlook
        // sí renderizan — SVG inline no se ve en ninguno de los dos.
        expect(html).toContain("background-color:#2563eb");
        expect(html).not.toContain("<svg");
        // Y el CSV adjunto.
        expect(adjuntos).toHaveLength(1);
        expect(adjuntos[0].contentType).toBe("text/csv");
        const csv = Buffer.from(adjuntos[0].contentBase64, "base64").toString("utf8");
        expect(csv.split("\n")[0]).toBe("grupo,gasto_usd,gasto_mes_anterior_usd,variacion_pct");
        expect(csv).toContain("Datos,");
    });

    it("un nombre de grupo con coma no parte la fila del CSV", async () => {
        listarMock.mockResolvedValue([{ id: 7, name: "P", reglas: [
            { grupo: "Datos, Core", tipo: "resource_group", clave: null, valor: "rg-datos", orden: 0 },
        ]}]);
        await enviarSuscripcion(sub(), { marcarEnviado: false });
        const csv = Buffer.from((mailMock.mock.calls[0] as any)[3][0].contentBase64, "base64").toString("utf8");
        expect(csv).toContain('"Datos, Core",');
    });
});

describe("criterio 3 — el alcance se respeta", () => {
    it("quien se suscribe a su grupo NO recibe el gasto de los demás", async () => {
        await enviarSuscripcion(sub({ perspectiveId: 7, grupo: "Datos" }), { marcarEnviado: false });
        const [, html, , adjuntos] = mailMock.mock.calls[0] as any;
        const csv = Buffer.from(adjuntos[0].contentBase64, "base64").toString("utf8");

        expect(html).toContain("Datos");
        expect(html).not.toContain(">Web<");
        expect(csv).not.toContain("Web,");
    });

    it("y el correo de un solo grupo no informa el sobrante del tenant", async () => {
        // El "sin asignar" es del tenant, no suyo: mostrárselo sería filtrarle
        // cuánto queda afuera de todos los equipos.
        filasMock.mockResolvedValue([fila("rg-datos", 1000), fila("rg-otro", 999)]);
        await enviarSuscripcion(sub({ perspectiveId: 7, grupo: "Datos" }), { marcarEnviado: false });
        expect((mailMock.mock.calls[0] as any)[1]).not.toContain("sin asignar");
    });

    it("en la vista completa sí, porque si no el total no cuadra con la factura", async () => {
        filasMock.mockResolvedValue([fila("rg-datos", 1000), fila("rg-otro", 999)]);
        await enviarSuscripcion(sub(), { marcarEnviado: false });
        expect((mailMock.mock.calls[0] as any)[1]).toContain("sin asignar");
    });
});

describe("lo que NO se manda", () => {
    it("un reporte sin datos no se manda: diría «tu equipo no gastó nada»", async () => {
        filasMock.mockResolvedValue([]);
        const r = await enviarSuscripcion(sub(), { marcarEnviado: false });
        expect(mailMock).not.toHaveBeenCalled();
        // Pero se informa: callar en silencio sería peor.
        expect(r.omitido).toBe("sin-datos");
    });

    it("sin Perspective definida tampoco", async () => {
        listarMock.mockResolvedValue([]);
        const r = await enviarSuscripcion(sub(), { marcarEnviado: false });
        expect(mailMock).not.toHaveBeenCalled();
        expect(r.filas).toBe(0);
    });
});

describe("cómo se manda", () => {
    it("un correo POR destinatario: nadie ve a quién más le llega", async () => {
        await enviarSuscripcion({ ...sub(), recipients: ["a@a.com", "b@b.com"] }, { marcarEnviado: false });
        expect(mailMock).toHaveBeenCalledTimes(2);
        expect((mailMock.mock.calls[0] as any)[2]).toBe("a@a.com");
        expect((mailMock.mock.calls[1] as any)[2]).toBe("b@b.com");
    });

    it("si uno rebota, el resto igual sale", async () => {
        mailMock.mockRejectedValueOnce(new Error("buzón lleno"));
        const r = await enviarSuscripcion({ ...sub(), recipients: ["a@a.com", "b@b.com"] }, { marcarEnviado: false });
        expect(r.enviados).toBe(1);
    });

    it("«enviar ahora» NO marca el período como enviado", async () => {
        // Si lo marcara, la prueba se comería el envío real de la semana.
        await enviarSuscripcion(sub(), { marcarEnviado: false });
        expect(queryMock.mock.calls.some(([s]) => String(s).includes("SET last_sent_at"))).toBe(false);
    });

    it("el envío programado sí lo marca", async () => {
        await enviarSuscripcion(sub(), { marcarEnviado: true });
        expect(queryMock.mock.calls.some(([s]) => String(s).includes("SET last_sent_at"))).toBe(true);
    });

    it("si NINGUNO salió, no se marca: la próxima corrida reintenta", async () => {
        // Marcarlo igual convertiría una caída de Graph en un período perdido.
        mailMock.mockRejectedValue(new Error("Graph caído"));
        await enviarSuscripcion(sub(), { marcarEnviado: true });
        expect(queryMock.mock.calls.some(([s]) => String(s).includes("SET last_sent_at"))).toBe(false);
    });
});

describe("criterio 4 — el usuario dado de baja", () => {
    it("su suscripción se desactiva y no se manda", async () => {
        queryMock.mockImplementation(async (sql: string) => {
            const s = String(sql);
            if (s.includes("FROM ReportSubscriptions rs")) {
                return [[{
                    id: 9, tenantId: "t1", reportType: "gasto-por-equipo", scope: null,
                    recipients: ["a@a.com"], frequency: "daily", dayOfWeek: null, dayOfMonth: null,
                    lastSentAt: null, createdBy: "sefue@acme.com", zona: "UTC",
                    estadoDelAutor: "DISABLED",
                }]];
            }
            if (s.includes("FROM Tenants")) return [[{ company_name: "Acme" }]];
            return [[]];
        });
        const { GET } = await import("@/app/api/cron/report-subscriptions/route");
        const j = await (await GET(new NextRequest("http://localhost/api/cron/report-subscriptions", {
            headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
        }))).json();

        expect(j.canceladasPorBaja).toBe(1);
        expect(mailMock).not.toHaveBeenCalled();
        // Se desactiva, no se borra: alguien tiene que poder ver por qué dejó
        // de llegar el reporte.
        expect(queryMock.mock.calls.some(([s]) => String(s).includes("SET active = 0"))).toBe(true);
    });
});
