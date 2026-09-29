// @vitest-environment node
/**
 * Cliente de Payoneer — alta de beneficiarios.
 *
 * El contrato está verificado contra la documentación (ver el encabezado del
 * servicio). Lo que se fija acá es lo que no se puede probar contra Payoneer
 * sin credenciales, y lo que cuesta caro si cambia sin que nadie mire:
 * a qué entorno le estamos hablando, y que el enlace que devolvemos exista.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
    configDePayoneer, payeeIdDe, tokenDeAplicacion, crearEnlaceDeRegistro, olvidarToken,
} from "@/services/payoneer.service";

const CONFIG = {
    clientId: "cid", clientSecret: "secreto", programId: "prog-1", entorno: "sandbox" as const,
};

const respuesta = (body: unknown, ok = true, status = 200) =>
    ({ ok, status, json: async () => body }) as Response;

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
    olvidarToken();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("configDePayoneer", () => {
    const limpio = { ...process.env };
    afterEach(() => { process.env = { ...limpio }; });

    it("sin credenciales devuelve null, que es el estado normal hasta pedirlas", () => {
        delete process.env.PAYONEER_CLIENT_ID;
        delete process.env.PAYONEER_CLIENT_SECRET;
        delete process.env.PAYONEER_PROGRAM_ID;
        expect(configDePayoneer()).toBeNull();
    });

    it("con una sola faltante tampoco arma config a medias", () => {
        process.env.PAYONEER_CLIENT_ID = "a";
        process.env.PAYONEER_CLIENT_SECRET = "b";
        delete process.env.PAYONEER_PROGRAM_ID;
        expect(configDePayoneer()).toBeNull();
    });

    it("EL DEFAULT ES SANDBOX: sólo 'production' exacto mueve plata real", () => {
        process.env.PAYONEER_CLIENT_ID = "a";
        process.env.PAYONEER_CLIENT_SECRET = "b";
        process.env.PAYONEER_PROGRAM_ID = "c";
        for (const v of [undefined, "", "prod", "Production", "PRODUCTION", "sandbox", "si"]) {
            if (v === undefined) delete process.env.PAYONEER_ENV;
            else process.env.PAYONEER_ENV = v;
            expect(configDePayoneer()!.entorno, `PAYONEER_ENV=${v}`).toBe("sandbox");
        }
        process.env.PAYONEER_ENV = "production";
        expect(configDePayoneer()!.entorno).toBe("production");
    });
});

describe("payeeIdDe", () => {
    it("separa los espacios de nombres de las dos tablas", () => {
        expect(payeeIdDe("affiliate", "abc")).toBe("aff-abc");
        expect(payeeIdDe("sales_rep", "abc")).toBe("rep-abc");
        // El mismo id en las dos tablas no puede dar el mismo payee_id: sería
        // mandarle la plata de uno a la cuenta del otro.
        expect(payeeIdDe("affiliate", "abc")).not.toBe(payeeIdDe("sales_rep", "abc"));
    });

    it("no se pasa de la columna", () => {
        expect(payeeIdDe("affiliate", "x".repeat(200))).toHaveLength(64);
    });
});

describe("tokenDeAplicacion", () => {
    it("manda Basic con las credenciales y el cuerpo urlencoded que pide OAuth2", async () => {
        fetchMock.mockResolvedValue(respuesta({ access_token: "tok", expires_in: 2592000 }));
        await tokenDeAplicacion(CONFIG);

        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe("https://login.sandbox.payoneer.com/api/v2/oauth2/token");
        expect(init.headers.Authorization).toBe(`Basic ${Buffer.from("cid:secreto").toString("base64")}`);
        expect(init.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
        expect(String(init.body)).toContain("grant_type=client_credentials");
    });

    it("le habla a producción sólo cuando el entorno es producción", async () => {
        fetchMock.mockResolvedValue(respuesta({ access_token: "tok", expires_in: 2592000 }));
        await tokenDeAplicacion({ ...CONFIG, entorno: "production" });
        expect(fetchMock.mock.calls[0][0]).toBe("https://login.payoneer.com/api/v2/oauth2/token");
    });

    it("cachea: el token vale 30 días y no se pide en cada llamada", async () => {
        fetchMock.mockResolvedValue(respuesta({ access_token: "tok", expires_in: 2592000 }));
        await tokenDeAplicacion(CONFIG);
        await tokenDeAplicacion(CONFIG);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("un token casi vencido se renueva en vez de usarse", async () => {
        // 12 horas de vida, y el margen es de 24: no alcanza para un lote.
        fetchMock.mockResolvedValue(respuesta({ access_token: "tok", expires_in: 43200 }));
        await tokenDeAplicacion(CONFIG);
        await tokenDeAplicacion(CONFIG);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("no filtra el secreto en el error", async () => {
        fetchMock.mockResolvedValue(respuesta({ error_description: "bad client" }, false, 401));
        await expect(tokenDeAplicacion(CONFIG)).rejects.toThrow(/401/);
        await expect(tokenDeAplicacion(CONFIG)).rejects.not.toThrow(/secreto/);
    });
});

describe("crearEnlaceDeRegistro", () => {
    const beneficiario = { id: "abc", nombre: "Laura Giménez", email: "laura@ejemplo.com" };

    const conAlta = (body: unknown) => {
        fetchMock
            .mockResolvedValueOnce(respuesta({ access_token: "tok", expires_in: 2592000 }))
            .mockResolvedValueOnce(respuesta(body));
    };

    it("pega en el endpoint del programa y manda lo que la API exige", async () => {
        conAlta({ result: { registration_link: "https://payoneer.test/r/xyz" } });
        const r = await crearEnlaceDeRegistro({
            config: CONFIG, tipo: "affiliate", beneficiario, redirectUrl: "https://app.test/es/partner",
        });

        const [url, init] = fetchMock.mock.calls[1];
        expect(url).toBe("https://api.sandbox.payoneer.com/v4/programs/prog-1/payees/registration-link");
        expect(init.headers.Authorization).toBe("Bearer tok");

        const cuerpo = JSON.parse(init.body);
        expect(cuerpo.payee_id).toBe("aff-abc");
        expect(cuerpo.redirect_url).toBe("https://app.test/es/partner");
        expect(cuerpo.payee.contact).toMatchObject({
            first_name: "Laura", last_name: "Giménez", email: "laura@ejemplo.com",
        });
        expect(r).toEqual({ payeeId: "aff-abc", registrationLink: "https://payoneer.test/r/xyz" });
    });

    it("lee el enlace esté donde esté: la documentación no lo deja claro", async () => {
        conAlta({ registration_link: "https://payoneer.test/r/plano" });
        const r = await crearEnlaceDeRegistro({
            config: CONFIG, tipo: "sales_rep", beneficiario, redirectUrl: "https://app.test/es/partner",
        });
        expect(r.registrationLink).toBe("https://payoneer.test/r/plano");
        expect(r.payeeId).toBe("rep-abc");
    });

    it("SIN ENLACE FALLA en vez de devolver un alta vacía", async () => {
        // Devolver `{ payeeId, registrationLink: "" }` dejaría la ficha marcada
        // como invitada y a la persona sin nada que completar.
        conAlta({ result: {} });
        await expect(crearEnlaceDeRegistro({
            config: CONFIG, tipo: "affiliate", beneficiario, redirectUrl: "https://app.test/es/partner",
        })).rejects.toThrow(/enlace/i);
    });

    it("un nombre de una sola palabra no rompe el apellido obligatorio", async () => {
        conAlta({ result: { registration_link: "https://payoneer.test/r/1" } });
        await crearEnlaceDeRegistro({
            config: CONFIG, tipo: "affiliate",
            beneficiario: { ...beneficiario, nombre: "Prince" },
            redirectUrl: "https://app.test/es/partner",
        });
        const cuerpo = JSON.parse(fetchMock.mock.calls[1][1].body);
        expect(cuerpo.payee.contact.first_name).toBe("Prince");
        expect(cuerpo.payee.contact.last_name).toBe("-");
    });
});
