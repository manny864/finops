/**
 * La URL pública de la plataforma, para armar enlaces que salen de acá.
 *
 * NO ES `internalBaseUrl`. Aquella es para que el servidor se llame a sí mismo
 * y por eso usa el loopback; esta es la que ve una persona que recibe un
 * enlace nuestro por correo. Confundirlas manda a alguien a `localhost`.
 *
 * POR QUÉ NO ALCANZA `request.nextUrl.origin`, que es lo que hacía cada
 * llamador por su cuenta: ese origin sale del Host de la request, o sea del
 * nombre con el que entró QUIEN PIDIÓ. Un operador que abre el panel por la
 * dirección de red del dev server genera enlaces a `0.0.0.0:3000`, y
 * `0.0.0.0` no es una dirección a la que se pueda ir: es "escuchar en
 * cualquier interfaz". Pasó de verdad con el enlace del panel del afiliado.
 * En producción el riesgo es el mismo con otra cara: entrar por el FQDN de
 * Azure en vez del dominio propio genera enlaces al FQDN de Azure.
 *
 * El orden es de más confiable a menos:
 *
 *  1. `NEXT_PUBLIC_APP_URL`, que es configuración explícita y la única que no
 *     depende de cómo entró nadie. **Hoy no está puesta en producción**, así
 *     que en la práctica se usa el paso 2.
 *  2. Las cabeceras que pone el proxy de entrada. Son las que saben el nombre
 *     con el que el mundo ve la aplicación.
 *  3. El origin de la request, como último recurso.
 *
 * `process.env.NEXT_PUBLIC_APP_URL` se lee con acceso literal a propósito: las
 * `NEXT_PUBLIC_*` sólo se inlinean así, y con una clave dinámica el servidor
 * leería `undefined` sin fallar ruidosamente.
 */

import type { NextRequest } from "next/server";

/** Hosts que significan "cualquier interfaz" y no son un destino. */
const NO_SON_DESTINO = new Set(["0.0.0.0", "::", "[::]"]);

/** Quita la barra final para poder concatenar rutas sin duplicarla. */
function sinBarra(url: string): string {
    return url.replace(/\/+$/, "");
}

/**
 * Reemplaza un host que no se puede visitar. Conserva el puerto: en
 * desarrollo `0.0.0.0:3000` y `localhost:3000` son el mismo servidor.
 */
function corregirHost(origin: string): string {
    try {
        const u = new URL(origin);
        if (NO_SON_DESTINO.has(u.hostname)) u.hostname = "localhost";
        return sinBarra(u.origin);
    } catch {
        return sinBarra(origin);
    }
}

export function urlPublica(request: NextRequest): string {
    const configurada = process.env.NEXT_PUBLIC_APP_URL;
    if (configurada) return corregirHost(configurada);

    const host = request.headers.get("x-forwarded-host");
    if (host) {
        // El proxy puede mandar una lista si hubo varios saltos; manda el primero.
        const primero = host.split(",")[0].trim();
        const proto = (request.headers.get("x-forwarded-proto") || "https").split(",")[0].trim();
        if (primero) return corregirHost(`${proto}://${primero}`);
    }

    return corregirHost(request.nextUrl.origin);
}
