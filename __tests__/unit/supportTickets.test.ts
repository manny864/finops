import { describe, it, expect } from "vitest";
import {
    buildGlobalSupportSummary,
    buildStatusCounts,
    buildUserSupportSummary,
    calcSlaRemainingMinutes,
    categoryToDb,
    computeSlaDeadline,
    formatSlaRemaining,
    isSlaBreachRisk,
    isValidAttachment,
    mapAttachment,
    mapMessage,
    mapTicket,
    priorityToDb,
    resolutionHours,
    statusToDb,
    stripInternalNotes,
    toCategory,
    toPriority,
    toStatus,
} from "@/services/supportTickets.service";
import type { SupportTicketItem } from "@/types/supportTickets.types";

const NOW = new Date("2026-08-22T12:00:00.000Z");

describe("Soporte — traducción de enums entre MySQL y el dominio", () => {
    it("mapea los valores heredados de la base al contrato", () => {
        expect(toCategory("question")).toBe("CONSULTA");
        expect(toCategory("billing")).toBe("FACTURACION_AZURE");
        expect(toCategory("feature_request")).toBe("SOLICITUD_FEATURE");
        expect(toStatus("waiting_customer")).toBe("WAITING_USER");
        expect(toPriority("urgent")).toBe("CRITICAL");
        expect(toPriority("high")).toBe("HIGH");
        expect(toPriority("medium")).toBe("MEDIUM");
        expect(toPriority("low")).toBe("LOW");
    });

    it("falla cerrado: un valor desconocido nunca inventa urgencia ni oculta el ticket", () => {
        expect(toPriority("catastrófica")).toBe("LOW");
        expect(toStatus("")).toBe("OPEN");
        expect(toCategory(undefined)).toBe("CONSULTA");
    });

    it("el ida y vuelta preserva el valor de la base", () => {
        expect(categoryToDb(toCategory("billing"))).toBe("billing");
        expect(priorityToDb("CRITICAL")).toBe("urgent");
        expect(priorityToDb("HIGH")).toBe("high");
        expect(priorityToDb("MEDIUM")).toBe("medium");
        expect(priorityToDb("LOW")).toBe("low");
        expect(priorityToDb(toPriority("urgent"))).toBe("urgent");
        expect(statusToDb(toStatus("in_progress"))).toBe("in_progress");
    });

    it("CONEXION_TENANT cae en 'technical' porque el ENUM de MySQL no tiene valor propio", () => {
        expect(categoryToDb("CONEXION_TENANT")).toBe("technical");
    });
});

describe("Soporte — SLA de primera respuesta", () => {
    it("el deadline sale de la creación más las horas del plan", () => {
        expect(computeSlaDeadline("2026-08-22T10:00:00.000Z", 4)).toBe("2026-08-22T14:00:00.000Z");
        expect(computeSlaDeadline("2026-08-22T10:00:00.000Z", 24)).toBe("2026-08-23T10:00:00.000Z");
    });

    it("un SLA vencido devuelve 0, no minutos negativos", () => {
        expect(calcSlaRemainingMinutes("2026-08-22T10:00:00.000Z", NOW)).toBe(0);
        expect(calcSlaRemainingMinutes("2026-08-22T14:15:00.000Z", NOW)).toBe(135);
    });

    it("sólo está en riesgo un ticket sin responder y en estado activo", () => {
        expect(isSlaBreachRisk("OPEN", 30)).toBe(true);
        expect(isSlaBreachRisk("IN_PROGRESS", 59)).toBe(true);
        // Ya respondido: el SLA de primera respuesta se cumplió.
        expect(isSlaBreachRisk("OPEN", 5, "2026-08-22T11:00:00.000Z")).toBe(false);
        // Esperando al cliente: el reloj no es responsabilidad del equipo.
        expect(isSlaBreachRisk("WAITING_USER", 5)).toBe(false);
        expect(isSlaBreachRisk("RESOLVED", 0)).toBe(false);
        expect(isSlaBreachRisk("OPEN", 61)).toBe(false);
    });

    it("formatea la cuenta regresiva en horas y minutos", () => {
        expect(formatSlaRemaining(135)).toBe("2h 15m");
        expect(formatSlaRemaining(45)).toBe("45m");
        expect(formatSlaRemaining(0)).toBe("Vencido");
    });
});

describe("Soporte — normalización de filas", () => {
    const row = {
        id: 42,
        tenant_id: "tenant-a",
        tenant_name: "Contoso",
        subject: "No carga el panel",
        category: "technical",
        status: "open",
        priority: "urgent",
        created_by_email: "ana@contoso.com",
        created_by_name: "Ana Torres",
        created_at: "2026-08-22T10:00:00.000Z",
        last_message_at: "2026-08-22T11:00:00.000Z",
        message_count: 3,
        related_module: "Zombies",
    };

    it("arma el número de ticket y deriva el SLA cuando la columna está vacía", () => {
        const t = mapTicket(row, { slaHours: 4, now: NOW });
        expect(t.ticketNumber).toBe("TICK-42");
        expect(t.slaDeadlineIso).toBe("2026-08-22T14:00:00.000Z");
        expect(t.slaRemainingMinutes).toBe(120);
        expect(t.isSlaBreachRisk).toBe(false);
        expect(t.priority).toBe("CRITICAL");
        expect(t.tenantDisplayName).toBe("Contoso");
        expect(t.relatedModule).toBe("Zombies");
    });

    it("respeta el sla_deadline explícito por encima del derivado", () => {
        const t = mapTicket({ ...row, sla_deadline: "2026-08-22T12:30:00.000Z" }, { slaHours: 24, now: NOW });
        expect(t.slaRemainingMinutes).toBe(30);
        // Sin primera respuesta y a 30 min de vencer: es el caso de riesgo.
        expect(t.isSlaBreachRisk).toBe(true);
    });

    it("un nombre vacío cae al email en vez de dejar la celda en blanco", () => {
        const t = mapTicket({ ...row, created_by_name: "   " }, { slaHours: 4, now: NOW });
        expect(t.creatorName).toBe("ana@contoso.com");
    });

    it("el adjunto se sirve por la ruta autenticada, nunca por URL directa al blob", () => {
        const a = mapAttachment({ id: 7, original_name: "log.txt", mime_type: "text/plain", size_bytes: 2048 });
        expect(a.storageBlobUrl).toBe("/api/support/attachments/7");
        expect(a.fileSizeBytes).toBe(2048);
    });

    it("la nota interna se marca desde el flag numérico de MySQL", () => {
        expect(mapMessage({ id: 1, is_internal_note: 1, author_role: "support" }).isInternalNote).toBe(true);
        expect(mapMessage({ id: 2, is_internal_note: 0, author_role: "user" }).isInternalNote).toBe(false);
        expect(mapMessage({ id: 3, author_role: "system" }).senderRole).toBe("SYSTEM");
    });

    it("stripInternalNotes deja fuera exactamente las notas internas", () => {
        const msgs = [
            mapMessage({ id: 1, author_role: "user", body: "hola" }),
            mapMessage({ id: 2, author_role: "support", body: "nota", is_internal_note: 1 }),
            mapMessage({ id: 3, author_role: "support", body: "respuesta" }),
        ];
        const visible = stripInternalNotes(msgs);
        expect(visible).toHaveLength(2);
        expect(visible.map((m) => m.id)).toEqual(["1", "3"]);
    });
});

describe("Soporte — resúmenes", () => {
    const base = mapTicket(
        { id: 1, tenant_id: "t", created_at: "2026-08-22T10:00:00.000Z", status: "open", priority: "medium", category: "question" },
        { slaHours: 4, now: NOW }
    );
    const t = (over: Partial<SupportTicketItem>): SupportTicketItem => ({ ...base, ...over });

    it("cuenta abiertos incluyendo los que esperan al cliente", () => {
        const s = buildUserSupportSummary(
            [t({ status: "OPEN" }), t({ status: "WAITING_USER" }), t({ status: "IN_PROGRESS" }), t({ status: "CLOSED" }), t({ status: "RESOLVED" })],
            8
        );
        expect(s.openTicketsCount).toBe(2);
        expect(s.inProgressCount).toBe(1);
        expect(s.resolvedCount).toBe(2);
        expect(s.planSlaHours).toBe(8);
    });

    it("el MTTR promedia sólo los resueltos y redondea a un decimal", () => {
        const s = buildGlobalSupportSummary([t({}), t({})], [2, 4, 5]);
        expect(s.avgResolutionTimeHours).toBe(3.7);
    });

    it("sin tickets resueltos el MTTR es 0, no NaN", () => {
        expect(buildGlobalSupportSummary([t({})], []).avgResolutionTimeHours).toBe(0);
    });

    it("cuenta sin asignar y en riesgo de SLA", () => {
        const s = buildGlobalSupportSummary(
            [
                t({ assignedAdminEmail: "a@cscloudsolutions.com.ar", isSlaBreachRisk: false }),
                t({ assignedAdminEmail: undefined, isSlaBreachRisk: true }),
                t({ assignedAdminEmail: undefined, isSlaBreachRisk: false }),
            ],
            []
        );
        expect(s.unassignedCount).toBe(2);
        expect(s.slaBreachRiskCount).toBe(1);
        expect(s.totalTicketsCount).toBe(3);
    });

    it("buildStatusCounts arranca en cero para todos los estados", () => {
        expect(buildStatusCounts([])).toEqual({ OPEN: 0, IN_PROGRESS: 0, WAITING_USER: 0, RESOLVED: 0, CLOSED: 0 });
        expect(buildStatusCounts([t({ status: "CLOSED" }), t({ status: "CLOSED" })]).CLOSED).toBe(2);
    });

    it("resolutionHours devuelve null si el ticket no se resolvió o las fechas no cierran", () => {
        expect(resolutionHours({ created_at: "2026-08-22T10:00:00.000Z" })).toBeNull();
        expect(resolutionHours({ created_at: "2026-08-22T10:00:00.000Z", resolved_at: "2026-08-22T13:30:00.000Z" })).toBe(3.5);
        // Resolución anterior a la creación: dato inconsistente, no se promedia.
        expect(resolutionHours({ created_at: "2026-08-22T13:00:00.000Z", resolved_at: "2026-08-22T10:00:00.000Z" })).toBeNull();
    });
});

describe("Soporte — validación de adjuntos", () => {
    it("acepta sólo las extensiones permitidas y hasta 5 MB", () => {
        expect(isValidAttachment({ name: "captura.png", size: 1024 })).toBe(true);
        expect(isValidAttachment({ name: "log.TXT", size: 1024 })).toBe(true);
        expect(isValidAttachment({ name: "payload.exe", size: 1024 })).toBe(false);
        expect(isValidAttachment({ name: "vacio.png", size: 0 })).toBe(false);
        expect(isValidAttachment({ name: "grande.png", size: 5 * 1024 * 1024 + 1 })).toBe(false);
        expect(isValidAttachment({ name: "limite.png", size: 5 * 1024 * 1024 })).toBe(true);
    });

    it("una doble extensión se valida por la última, que es la que manda", () => {
        expect(isValidAttachment({ name: "shell.png.exe", size: 10 })).toBe(false);
        expect(isValidAttachment({ name: "reporte.exe.png", size: 10 })).toBe(true);
    });
});
