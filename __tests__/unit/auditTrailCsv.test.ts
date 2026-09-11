// @vitest-environment node
import { describe, it, expect } from "vitest";
import { serializeAuditTrailCsv } from "@/services/auditTrail.service";

/**
 * El CSV salia con las cabeceras fijas en castellano ("Fecha_UTC",
 * "Tipo_Accion"), asi que un admin con la plataforma en ingles descargaba un
 * archivo que no podia leer ni pasarle a su auditor. El archivo lo arma el
 * servidor, por eso `t` entra por parametro.
 */
const items = [
    {
        id: 1, createdAtIso: "2026-09-01T10:00:00.000Z", userEmail: "a@b.com",
        userName: "Ana", actionType: "START_VM", resourceTargetName: 'vm-"prod"-01',
        status: "SUCCESS", ipAddress: "10.0.0.1",
    },
    {
        id: 2, createdAtIso: "2026-09-02T11:00:00.000Z", userEmail: "c@d.com",
        userName: "", actionType: "DELETE_ZOMBIE", resourceTargetName: "disk-01, disk-02",
        status: "FAILED", ipAddress: "",
    },
] as never[];

const dicc: Record<string, string> = {
    csvHeader_id: "ID", csvHeader_date: "Date (UTC)", csvHeader_userEmail: "User email",
    csvHeader_userName: "Name", csvHeader_actionType: "Action type",
    csvHeader_resource: "Resource / target", csvHeader_status: "Status",
    csvHeader_ip: "Source IP", status_SUCCESS: "Successful", status_FAILED: "Failed",
};
const t = (k: string) => dicc[k] ?? `AdminAudit.${k}`;

describe("CSV del audit trail", () => {
    it("escribe las cabeceras en el idioma pedido", () => {
        const csv = serializeAuditTrailCsv(items, t);
        expect(csv.split("\r\n")[0]).toBe(
            '"ID","Date (UTC)","User email","Name","Action type","Resource / target","Status","Source IP"'
        );
        expect(csv).not.toContain("Fecha_UTC");
    });

    it("traduce el estado pero NO el tipo de accion", () => {
        const csv = serializeAuditTrailCsv(items, t);
        expect(csv).toContain('"Successful"');
        expect(csv).toContain('"Failed"');
        /*
         * El actionType es el identificador con el que se filtra y con el que
         * se comparan exportaciones entre idiomas. Traducirlo haria que dos
         * CSV del mismo tenant no se puedan cruzar.
         */
        expect(csv).toContain('"START_VM"');
        expect(csv).toContain('"DELETE_ZOMBIE"');
    });

    it("escapa comillas y comas segun RFC 4180", () => {
        const csv = serializeAuditTrailCsv(items, t);
        // Comillas internas duplicadas.
        expect(csv).toContain('"vm-""prod""-01"');
        // La coma del valor no puede partir la fila en dos campos.
        const filas = csv.split("\r\n");
        expect(filas).toHaveLength(3);
        expect(filas[2]).toContain('"disk-01, disk-02"');
    });

    it("si falta la traduccion deja el valor crudo y no la ruta de la clave", () => {
        const csv = serializeAuditTrailCsv([{ ...items[0], status: "PENDING" } as never], t);
        expect(csv).toContain('"PENDING"');
        expect(csv).not.toContain("AdminAudit.status_PENDING");
    });

    it("sin `t` no rompe: devuelve las claves, nunca undefined", () => {
        expect(() => serializeAuditTrailCsv(items)).not.toThrow();
    });
});
