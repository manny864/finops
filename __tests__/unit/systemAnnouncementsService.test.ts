// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const queryMock = vi.fn();
vi.mock("@/modules/storage/db", () => ({ default: { query: (...args: unknown[]) => queryMock(...args) } }));

import {
    createAnnouncement,
    updateAnnouncement,
    getActiveAnnouncementsForTenant,
    recordDismissal,
    resolveAnnouncementContent,
} from "@/services/systemAnnouncements.service";

// El filtro de vigencia corre en JS contra `new Date()` REAL (ver
// getActiveAnnouncementsForTenant: comparar contra el NOW() de MySQL rompía
// cuando el contenedor corre en UTC y el dato se guardó en hora local -- bug
// real encontrado 2026-09-01). Por eso la ventana por defecto se calcula
// relativa a "ahora" y no como fechas de calendario sueltas -- mismo
// principio que MEJ-31: una fecha hardcodeada contra un reloj real es un bug
// latente, no un dato de prueba válido.
const HOUR = 60 * 60 * 1000;
// Componentes LOCALES, no `.toISOString()` (UTC): el código bajo prueba
// interpreta este string igual que mysql2 interpreta una columna DATETIME
// naive -- como hora LOCAL del proceso, no UTC. Usar toISOString() acá
// reproduciría el mismo desfase de 3hs que causó el bug real.
const sqlDatetime = (d: Date) => {
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

/** Valor de una columna en los params del INSERT, ubicada leyendo la lista de
 *  columnas del propio SQL. Evita índices posicionales hardcodeados, que se
 *  rompen cada vez que se agrega una columna. */
function insertedValue(call: [string, unknown[]], column: string): unknown {
    const [sql, params] = call;
    const columnList = String(sql).match(/\(([^)]+)\)\s*VALUES/i)?.[1] || "";
    const index = columnList.split(",").map((c) => c.trim()).indexOf(column);
    if (index === -1) throw new Error(`La columna "${column}" no está en el INSERT`);
    return params[index];
}

const row = (overrides: Record<string, unknown> = {}) => ({
    id: 1,
    title: "Mantenimiento programado",
    message: "El servicio no estará disponible entre las 22:00 y las 02:00 UTC.",
    severity: "maintenance",
    channels: "banner,popup",
    target_all_tenants: 1,
    target_tenant_ids: null,
    action_url: null,
    starts_at: sqlDatetime(new Date(Date.now() - HOUR)),
    ends_at: sqlDatetime(new Date(Date.now() + HOUR)),
    status: "published",
    created_by_email: "ops@cscloudsolutions.com.ar",
    created_at: sqlDatetime(new Date(Date.now() - 7 * HOUR)),
    updated_at: sqlDatetime(new Date(Date.now() - 7 * HOUR)),
    ...overrides,
});

beforeEach(() => {
    queryMock.mockReset();
});

describe("createAnnouncement — validación antes de tocar la DB", () => {
    it("rechaza una ventana de vigencia invertida", async () => {
        await expect(
            createAnnouncement(
                {
                    title: "x", message: "x", severity: "info", channels: ["banner"],
                    targetAllTenants: true, startsAt: "2026-08-10T10:00", endsAt: "2026-08-01T10:00",
                    status: "draft",
                },
                "admin@x.com"
            )
        ).rejects.toThrow(/finalización/);
        expect(queryMock).not.toHaveBeenCalled();
    });

    it("rechaza un anuncio sin ningún canal", async () => {
        await expect(
            createAnnouncement(
                {
                    title: "x", message: "x", severity: "info", channels: [],
                    targetAllTenants: true, startsAt: "2026-08-01T10:00", endsAt: "2026-08-10T10:00",
                    status: "draft",
                },
                "admin@x.com"
            )
        ).rejects.toThrow(/canal/);
        expect(queryMock).not.toHaveBeenCalled();
    });

    it("inserta con los canales serializados y devuelve la fila creada", async () => {
        queryMock
            .mockResolvedValueOnce([{ insertId: 42 }]) // INSERT
            .mockResolvedValueOnce([[row({ id: 42 })]]); // SELECT de vuelta

        const result = await createAnnouncement(
            {
                title: "  Mantenimiento  ", message: "msg", severity: "maintenance", channels: ["banner", "popup"],
                targetAllTenants: true, startsAt: "2026-08-01T00:00", endsAt: "2026-08-01T04:00",
                status: "published",
            },
            "admin@x.com"
        );

        expect(result.id).toBe(42);
        // Por VALOR y no por índice posicional: agregar una columna al INSERT
        // no debería romper este test (pasó al sumar `translations`).
        const insertParams = queryMock.mock.calls[0][1];
        expect(insertParams).toContain("Mantenimiento"); // trim()
        expect(insertParams).toContain("banner,popup"); // SET serializado
        expect(insertParams).toContain("admin@x.com");
    });
});

describe("updateAnnouncement — valida la ventana efectiva, no sólo el campo tocado", () => {
    it("si sólo se cambia endsAt, valida contra el startsAt YA GUARDADO", async () => {
        queryMock.mockResolvedValueOnce([[{ starts_at: "2026-08-10 00:00:00", ends_at: "2026-08-15 00:00:00" }]]);

        // Mover el fin a ANTES del inicio guardado -- debe rechazar aunque el
        // caller no haya tocado startsAt.
        await expect(updateAnnouncement(1, { endsAt: "2026-08-05T00:00" })).rejects.toThrow(/finalización/);
    });

    it("actualiza sólo los campos provistos", async () => {
        queryMock
            .mockResolvedValueOnce([[{ starts_at: "2026-08-01 00:00:00", ends_at: "2026-08-10 00:00:00" }]]) // lectura de fechas existentes
            .mockResolvedValueOnce([{}]) // UPDATE
            .mockResolvedValueOnce([[row({ status: "cancelled" })]]); // SELECT final

        const result = await updateAnnouncement(1, { status: "cancelled" });

        expect(result.status).toBe("cancelled");
        const updateSql = queryMock.mock.calls[1][0];
        expect(updateSql).toContain("status = ?");
        expect(updateSql).not.toContain("title = ?");
    });
});

describe("getActiveAnnouncementsForTenant", () => {
    it("incluye un anuncio con target_all_tenants aunque el tenant no esté en ninguna lista", async () => {
        queryMock
            .mockResolvedValueOnce([[row()]])
            .mockResolvedValueOnce([[]]); // sin dismissals

        const result = await getActiveAnnouncementsForTenant("tenant-x", "user@x.com");
        expect(result).toHaveLength(1);
        expect(result[0].dismissedByUser).toBe(false);
    });

    it("excluye un anuncio dirigido a otros tenants", async () => {
        queryMock.mockResolvedValueOnce([[
            row({ id: 2, target_all_tenants: 0, target_tenant_ids: JSON.stringify(["tenant-y", "tenant-z"]) }),
        ]]);

        const result = await getActiveAnnouncementsForTenant("tenant-x", "user@x.com");
        expect(result).toHaveLength(0);
        // Ni siquiera consulta dismissals si no quedó ningún candidato.
        expect(queryMock).toHaveBeenCalledTimes(1);
    });

    it("incluye un anuncio dirigido específicamente a este tenant", async () => {
        queryMock
            .mockResolvedValueOnce([[
                row({ id: 3, target_all_tenants: 0, target_tenant_ids: JSON.stringify(["tenant-x", "tenant-y"]) }),
            ]])
            .mockResolvedValueOnce([[]]);

        const result = await getActiveAnnouncementsForTenant("tenant-x", "user@x.com");
        expect(result).toHaveLength(1);
    });

    // El caso que justifica trackear dismissals en DB y no sólo en localStorage:
    // si el usuario ya lo descartó, no debe volver a aparecer para el popup.
    it("marca dismissedByUser cuando el usuario ya descartó el anuncio", async () => {
        queryMock
            .mockResolvedValueOnce([[row({ id: 5 })]])
            .mockResolvedValueOnce([[{ announcement_id: 5 }]]);

        const result = await getActiveAnnouncementsForTenant("tenant-x", "user@x.com");
        expect(result[0].dismissedByUser).toBe(true);
    });

    it("el dismiss de un usuario no afecta a otro", async () => {
        queryMock
            .mockResolvedValueOnce([[row({ id: 5 })]])
            .mockResolvedValueOnce([[]]); // este usuario no está en UserAnnouncementDismissals

        const result = await getActiveAnnouncementsForTenant("tenant-x", "otro-user@x.com");
        expect(result[0].dismissedByUser).toBe(false);
    });
});

describe("displayStatus — derivado de fechas, nunca escrito a la DB", () => {
    it("un published con starts_at futuro se muestra como 'scheduled'", async () => {
        queryMock.mockResolvedValueOnce([[
            row({ id: 6, starts_at: "2099-01-01 00:00:00", ends_at: "2099-01-02 00:00:00" }),
        ]]);
        // No entra en la ventana activa (WHERE starts_at <= NOW()), así que en
        // la práctica esta fila nunca la devuelve getActiveAnnouncementsForTenant
        // -- se prueba directamente contra el listado del panel, vía createAnnouncement.
        queryMock.mockReset();
        queryMock
            .mockResolvedValueOnce([{ insertId: 6 }])
            .mockResolvedValueOnce([[row({ id: 6, starts_at: "2099-01-01 00:00:00", ends_at: "2099-01-02 00:00:00" })]]);

        const result = await createAnnouncement(
            { title: "x", message: "x", severity: "info", channels: ["banner"], targetAllTenants: true, startsAt: "2099-01-01T00:00", endsAt: "2099-01-02T00:00", status: "published" },
            "admin@x.com"
        );
        expect(result.displayStatus).toBe("scheduled");
    });

    it("un published con ends_at pasado se muestra como 'finished'", async () => {
        queryMock
            .mockResolvedValueOnce([{ insertId: 7 }])
            .mockResolvedValueOnce([[row({ id: 7, starts_at: "2020-01-01 00:00:00", ends_at: "2020-01-02 00:00:00" })]]);

        const result = await createAnnouncement(
            { title: "x", message: "x", severity: "info", channels: ["banner"], targetAllTenants: true, startsAt: "2020-01-01T00:00", endsAt: "2020-01-02T00:00", status: "published" },
            "admin@x.com"
        );
        expect(result.displayStatus).toBe("finished");
    });

    it("un draft se muestra como 'draft' sin importar las fechas", async () => {
        queryMock
            .mockResolvedValueOnce([{ insertId: 8 }])
            .mockResolvedValueOnce([[row({ id: 8, status: "draft", starts_at: "2020-01-01 00:00:00", ends_at: "2099-01-01 00:00:00" })]]);

        const result = await createAnnouncement(
            { title: "x", message: "x", severity: "info", channels: ["banner"], targetAllTenants: true, startsAt: "2020-01-01T00:00", endsAt: "2099-01-01T00:00", status: "draft" },
            "admin@x.com"
        );
        expect(result.displayStatus).toBe("draft");
    });
});

describe("recordDismissal", () => {
    it("usa INSERT IGNORE: descartar dos veces no rompe", async () => {
        queryMock.mockResolvedValue([{}]);
        await recordDismissal(1, "user@x.com");
        expect(queryMock.mock.calls[0][0]).toContain("INSERT IGNORE");
        expect(queryMock.mock.calls[0][1]).toEqual([1, "user@x.com"]);
    });
});

describe("resolveAnnouncementContent — idioma activo con fallback (i18n del contenido)", () => {
    const base = {
        title: "Mantenimiento programado",
        message: "El servicio estará interrumpido.",
    };

    it("devuelve el idioma base cuando no hay traducciones", () => {
        expect(resolveAnnouncementContent({ ...base, translations: null }, "en")).toEqual(base);
    });

    it("devuelve la traducción cuando existe para el locale pedido", () => {
        const result = resolveAnnouncementContent(
            { ...base, translations: { en: { title: "Scheduled maintenance", message: "Service will be down." } } },
            "en"
        );
        expect(result.title).toBe("Scheduled maintenance");
        expect(result.message).toBe("Service will be down.");
    });

    // El caso central: un aviso urgente se publica en un solo idioma y el resto
    // de los usuarios tiene que ver ALGO, no un hueco en blanco.
    it("cae al idioma base cuando el locale pedido no está traducido", () => {
        const result = resolveAnnouncementContent(
            { ...base, translations: { en: { title: "Scheduled maintenance", message: "Down." } } },
            "pt-BR"
        );
        expect(result).toEqual(base);
    });

    it("cae al idioma base si la traducción existe pero quedó a medias", () => {
        // Un título traducido con mensaje vacío mostraría un cuerpo en blanco:
        // peor que mostrarlo entero en el idioma base.
        const result = resolveAnnouncementContent(
            { ...base, translations: { en: { title: "Scheduled maintenance", message: "   " } } },
            "en"
        );
        expect(result).toEqual(base);
    });

    it("pedir el idioma base nunca mira las traducciones", () => {
        const result = resolveAnnouncementContent(
            { ...base, translations: { es: { title: "OTRO", message: "OTRO" } } },
            "es"
        );
        expect(result).toEqual(base);
    });

    // El locale de la plataforma es `pt-BR`; si alguien guardó la traducción
    // como `pt`, el usuario brasileño no debería caer a español por eso.
    it("pt-BR acepta una traducción guardada como pt", () => {
        const result = resolveAnnouncementContent(
            { ...base, translations: { pt: { title: "Manutenção", message: "Serviço indisponível." } } },
            "pt-BR"
        );
        expect(result.title).toBe("Manutenção");
    });
});

describe("traducciones — persistencia", () => {
    it("descarta las traducciones incompletas al crear", async () => {
        queryMock
            .mockResolvedValueOnce([{ insertId: 10 }])
            .mockResolvedValueOnce([[row({ id: 10 })]]);

        await createAnnouncement(
            {
                title: "x", message: "y", severity: "info", channels: ["banner"], targetAllTenants: true,
                startsAt: "2026-09-01T00:00", endsAt: "2026-09-02T00:00", status: "draft",
                translations: {
                    en: { title: "Full", message: "Complete" },
                    "pt-BR": { title: "Sólo título", message: "" }, // incompleta
                },
            },
            "admin@x.com"
        );

        const stored = JSON.parse(
            insertedValue(queryMock.mock.calls[0] as [string, unknown[]], "translations") as string
        );
        expect(Object.keys(stored)).toEqual(["en"]);
    });

    it("guarda null cuando ninguna traducción está completa", async () => {
        queryMock
            .mockResolvedValueOnce([{ insertId: 11 }])
            .mockResolvedValueOnce([[row({ id: 11 })]]);

        await createAnnouncement(
            {
                title: "x", message: "y", severity: "info", channels: ["banner"], targetAllTenants: true,
                startsAt: "2026-09-01T00:00", endsAt: "2026-09-02T00:00", status: "draft",
                translations: { en: { title: "", message: "" } },
            },
            "admin@x.com"
        );

        expect(insertedValue(queryMock.mock.calls[0] as [string, unknown[]], "translations")).toBeNull();
    });

    it("getActiveAnnouncementsForTenant resuelve al locale pedido", async () => {
        queryMock
            .mockResolvedValueOnce([[row({
                translations: JSON.stringify({ en: { title: "Maintenance", message: "Down." } }),
            })]])
            .mockResolvedValueOnce([[]]);

        const result = await getActiveAnnouncementsForTenant("tenant-x", "user@x.com", "en");

        expect(result[0].resolvedTitle).toBe("Maintenance");
        // El original se conserva intacto para que el panel edite el base.
        expect(result[0].title).toBe("Mantenimiento programado");
    });
});
