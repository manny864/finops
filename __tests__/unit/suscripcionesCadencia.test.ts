// @vitest-environment node
/**
 * MEJ-35 — la cadencia, que es la mejora entera.
 *
 * El cron corre cada hora: una suscripción semanal lo ve 168 veces por semana.
 * Si la decisión se pasa de generosa, el cliente recibe el mismo reporte
 * veinticuatro veces; si se queda corta, deja de llegar — y la ausencia de un
 * correo no avisa, que es el peor de los dos.
 */
import { describe, it, expect } from "vitest";
import {
    correspondeEnviar, enZona, diaEfectivoDelMes, diasDelMes, type Suscripcion,
} from "@/services/reportSubscriptions.service";

const sub = (p: Partial<Suscripcion>): Suscripcion => ({
    id: 1, frequency: "daily", dayOfWeek: null, dayOfMonth: null, lastSentAt: null, ...p,
});
const UTC = "UTC";

describe("criterio 1 — una semanal se manda UNA vez por semana", () => {
    const lunes = sub({ frequency: "weekly", dayOfWeek: 1 });

    it("manda la primera corrida del lunes", () => {
        const d = correspondeEnviar(lunes, new Date("2026-09-28T00:30:00Z"), UTC); // lunes
        expect(d.debe).toBe(true);
        expect(d.periodo).toBe("2026-09-28");
    });

    it("y NO las otras 23 del mismo lunes", () => {
        const yaMandada = { ...lunes, lastSentAt: new Date("2026-09-28T00:30:00Z") };
        for (const hora of ["01", "09", "13", "23"]) {
            const d = correspondeEnviar(yaMandada, new Date(`2026-09-28T${hora}:30:00Z`), UTC);
            expect(d.debe, `falló a las ${hora}h`).toBe(false);
            expect(d.motivo).toBe("ya-se-mando");
        }
    });

    it("ni ningún otro día de la semana", () => {
        for (const dia of ["29", "30"]) {
            expect(correspondeEnviar(lunes, new Date(`2026-09-${dia}T09:00:00Z`), UTC).motivo)
                .toBe("hoy-no-toca");
        }
    });

    it("vuelve a mandar el lunes siguiente", () => {
        const yaMandada = { ...lunes, lastSentAt: new Date("2026-09-28T09:00:00Z") };
        expect(correspondeEnviar(yaMandada, new Date("2026-10-05T09:00:00Z"), UTC).debe).toBe(true);
    });

    it("las 168 corridas de la semana producen exactamente UN envío", () => {
        let estado = lunes;
        let enviados = 0;
        for (let h = 0; h < 168; h++) {
            const ahora = new Date(Date.UTC(2026, 8, 28, h)); // desde el lunes 28
            const d = correspondeEnviar(estado, ahora, UTC);
            if (d.debe) { enviados++; estado = { ...estado, lastSentAt: ahora }; }
        }
        expect(enviados).toBe(1);
    });
});

describe("la mensual y el 31 de febrero", () => {
    it("un día 31 se recorta al último del mes en vez de saltearse el mes", () => {
        // Sin el recorte, "el 31" no llegaría NUNCA en febrero, abril, junio…
        // y el usuario no tendría cómo notarlo.
        expect(diaEfectivoDelMes(31, 2026, 2)).toBe(28);
        expect(diaEfectivoDelMes(31, 2028, 2)).toBe(29); // bisiesto
        expect(diaEfectivoDelMes(31, 2026, 4)).toBe(30);
        expect(diaEfectivoDelMes(31, 2026, 12)).toBe(31);
    });

    it("y entonces sí se manda el 28 de febrero", () => {
        const s = sub({ frequency: "monthly", dayOfMonth: 31 });
        expect(correspondeEnviar(s, new Date("2026-02-28T09:00:00Z"), UTC).debe).toBe(true);
        expect(correspondeEnviar(s, new Date("2026-02-27T09:00:00Z"), UTC).debe).toBe(false);
    });

    it("una mensual normal se manda una vez al mes", () => {
        const s = sub({ frequency: "monthly", dayOfMonth: 5, lastSentAt: new Date("2026-09-05T09:00:00Z") });
        expect(correspondeEnviar(s, new Date("2026-09-05T23:00:00Z"), UTC).debe).toBe(false);
        expect(correspondeEnviar(s, new Date("2026-10-05T09:00:00Z"), UTC).debe).toBe(true);
    });

    it("diasDelMes no se equivoca con el bisiesto", () => {
        expect(diasDelMes(2026, 2)).toBe(28);
        expect(diasDelMes(2028, 2)).toBe(29);
    });
});

describe("la zona del tenant, no la del servidor", () => {
    it("«los lunes» es el lunes DEL TENANT, no el de UTC", () => {
        // Lunes 00:30 en Buenos Aires (UTC-3) es domingo 21:30 en UTC. Con la
        // zona del servidor, la semanal del lunes se dispararía el domingo.
        const lunes = sub({ frequency: "weekly", dayOfWeek: 1 });
        const instante = new Date("2026-09-28T03:30:00Z"); // lunes 00:30 en BA
        expect(correspondeEnviar(lunes, instante, "America/Argentina/Buenos_Aires").debe).toBe(true);

        // Y el mismo instante, para un tenant en Tokio, ya es lunes al mediodía:
        // también toca. Lo que no puede pasar es que dependa del servidor.
        expect(enZona(instante, "Asia/Tokyo").diaSemana).toBe(1);
    });

    it("domingo a la noche en UTC todavía NO es lunes para un tenant al oeste", () => {
        const lunes = sub({ frequency: "weekly", dayOfWeek: 1 });
        const instante = new Date("2026-09-28T02:00:00Z"); // domingo 23:00 en BA
        expect(correspondeEnviar(lunes, instante, "America/Argentina/Buenos_Aires").motivo)
            .toBe("hoy-no-toca");
    });

    it("«ya se mandó hoy» también se mide en la zona del tenant", () => {
        const diaria = sub({
            frequency: "daily",
            // 03:30Z del lunes = lunes 00:30 en BA.
            lastSentAt: new Date("2026-09-28T03:30:00Z"),
        });
        // 20:00Z del lunes sigue siendo lunes en BA: no se repite.
        expect(correspondeEnviar(diaria, new Date("2026-09-28T20:00:00Z"), "America/Argentina/Buenos_Aires").debe)
            .toBe(false);
        // 03:30Z del martes ya es martes en BA: toca de nuevo.
        expect(correspondeEnviar(diaria, new Date("2026-09-29T03:30:00Z"), "America/Argentina/Buenos_Aires").debe)
            .toBe(true);
    });
});

describe("configuraciones incompletas no mandan a ciegas", () => {
    it("una semanal sin día no se manda todos los días", () => {
        expect(correspondeEnviar(sub({ frequency: "weekly", dayOfWeek: null }), new Date(), UTC).debe).toBe(false);
    });
    it("una mensual sin día tampoco", () => {
        expect(correspondeEnviar(sub({ frequency: "monthly", dayOfMonth: null }), new Date(), UTC).debe).toBe(false);
    });
});
