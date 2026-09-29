// @vitest-environment node
/**
 * La URL pública, que es la que viaja en los enlaces que le mandamos a alguien
 * de afuera. Un enlace mal armado no falla: llega, y no abre nada.
 */
import { describe, it, expect, afterEach } from "vitest";
import { urlPublica } from "@/lib/urlPublica";

/** Una request con el origin y las cabeceras que interesan. */
function pedido(origin: string, headers: Record<string, string> = {}) {
    return {
        nextUrl: { origin },
        headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
    } as any;
}

const limpio = { ...process.env };
afterEach(() => { process.env = { ...limpio }; });

describe("urlPublica", () => {
    it("la configuración explícita gana sobre todo lo demás", () => {
        process.env.NEXT_PUBLIC_APP_URL = "https://finops.cscloudsolutions.com.ar";
        const r = pedido("https://cualquier-cosa.azurecontainerapps.io", {
            "x-forwarded-host": "otra.cosa.com",
        });
        expect(urlPublica(r)).toBe("https://finops.cscloudsolutions.com.ar");
    });

    it("sin configurar, manda lo que dice el proxy de entrada", () => {
        delete process.env.NEXT_PUBLIC_APP_URL;
        const r = pedido("http://10.0.0.4:3000", {
            "x-forwarded-host": "finops.cscloudsolutions.com.ar",
            "x-forwarded-proto": "https",
        });
        expect(urlPublica(r)).toBe("https://finops.cscloudsolutions.com.ar");
    });

    it("con varios saltos toma el primero, que es el que ve el usuario", () => {
        delete process.env.NEXT_PUBLIC_APP_URL;
        const r = pedido("http://10.0.0.4:3000", {
            "x-forwarded-host": "finops.cscloudsolutions.com.ar, interno.azure",
            "x-forwarded-proto": "https, http",
        });
        expect(urlPublica(r)).toBe("https://finops.cscloudsolutions.com.ar");
    });

    it("sin nada, cae al origin de la request", () => {
        delete process.env.NEXT_PUBLIC_APP_URL;
        expect(urlPublica(pedido("https://finops.cscloudsolutions.com.ar"))).toBe(
            "https://finops.cscloudsolutions.com.ar",
        );
    });

    it("0.0.0.0 NO ES UN DESTINO: se corrige a localhost conservando el puerto", () => {
        // El bug reportado: un operador entra al panel por la dirección de red
        // que imprime el dev server y el enlace del partner sale a 0.0.0.0.
        delete process.env.NEXT_PUBLIC_APP_URL;
        expect(urlPublica(pedido("https://0.0.0.0:3000"))).toBe("https://localhost:3000");
        expect(urlPublica(pedido("http://0.0.0.0:3000"))).toBe("http://localhost:3000");
        expect(urlPublica(pedido("http://[::]:3000"))).toBe("http://localhost:3000");
    });

    it("lo corrige venga de donde venga, incluso de la variable", () => {
        // Si alguien copia el valor del dev server a la configuración, tampoco.
        process.env.NEXT_PUBLIC_APP_URL = "http://0.0.0.0:3000";
        expect(urlPublica(pedido("http://otra:1"))).toBe("http://localhost:3000");
    });

    it("localhost se respeta: en desarrollo es un destino válido", () => {
        delete process.env.NEXT_PUBLIC_APP_URL;
        expect(urlPublica(pedido("http://localhost:3000"))).toBe("http://localhost:3000");
        expect(urlPublica(pedido("http://127.0.0.1:3000"))).toBe("http://127.0.0.1:3000");
    });

    it("sin barra final, para poder concatenar la ruta sin duplicarla", () => {
        process.env.NEXT_PUBLIC_APP_URL = "https://finops.cscloudsolutions.com.ar/";
        expect(`${urlPublica(pedido("http://x"))}/es/partner`).toBe(
            "https://finops.cscloudsolutions.com.ar/es/partner",
        );
    });
});
