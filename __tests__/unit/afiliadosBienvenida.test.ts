import { describe, it, expect, vi } from "vitest";
import { getAffiliateWelcomeEmail } from "@/lib/emailHelper";
import { enviarBienvenidaAfiliado } from "@/services/affiliates.service";

/**
 * Mail de bienvenida al afiliado: lo que se fija acá es que lleve los tres
 * datos que el partner necesita (nombre, link de referido y panel) y que un
 * envío fallido no tumbe el alta.
 */

const DATOS = {
    nombre: "Ana Partner",
    email: "ana@partner.com",
    linkReferido: "https://finops.cscloudsolutions.com.ar/signup?ref=ana_dev",
    linkPanel: "https://finops.cscloudsolutions.com.ar/partner#k=afp_live_abc123",
};

describe("afiliados · mail de bienvenida", () => {
    it("lleva el nombre, el link de referido y el enlace al panel", () => {
        const { subject, html } = getAffiliateWelcomeEmail({ ...DATOS, locale: "es" });
        expect(subject).toBe("Bienvenido al programa de afiliados de CSCloudSolutions");
        expect(html).toContain("Ana Partner");
        expect(html).toContain(`href="${DATOS.linkReferido}"`);
        expect(html).toContain(`href="${DATOS.linkPanel}"`);
        expect(html).toContain("no lo compartas");
    });

    it("sale en el idioma pedido, y en castellano si no se reconoce", () => {
        expect(getAffiliateWelcomeEmail({ ...DATOS, locale: "en" }).subject).toBe("Welcome to the CSCloudSolutions affiliate program");
        expect(getAffiliateWelcomeEmail({ ...DATOS, locale: "pt-BR" }).subject).toBe("Bem-vindo ao programa de afiliados da CSCloudSolutions");
        expect(getAffiliateWelcomeEmail({ ...DATOS, locale: "fr" }).subject).toBe("Bienvenido al programa de afiliados de CSCloudSolutions");
    });

    it("escapa el nombre: lo carga un operador y termina en HTML", () => {
        const { html } = getAffiliateWelcomeEmail({ ...DATOS, nombre: '<img src=x onerror="alert(1)">' });
        expect(html).not.toContain("<img src=x");
        expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    });

    it("manda al mail del afiliado y avisa que salió", async () => {
        const enviar = vi.fn().mockResolvedValue(undefined);
        const r = await enviarBienvenidaAfiliado({ ...DATOS, locale: "es" }, enviar);
        expect(r).toEqual({ enviado: true });
        expect(enviar).toHaveBeenCalledTimes(1);
        const [subject, html, destinatario] = enviar.mock.calls[0];
        expect(destinatario).toBe("ana@partner.com");
        expect(subject).toContain("afiliados");
        expect(html).toContain(DATOS.linkPanel);
    });

    it("si el envío falla no tira: el alta ya está hecha", async () => {
        const enviar = vi.fn().mockRejectedValue(new Error("Graph 401"));
        const r = await enviarBienvenidaAfiliado(DATOS, enviar);
        expect(r).toEqual({ enviado: false, error: "Graph 401" });
    });
});
