import React from "react";
import type { Metadata } from "next";
import "./globals.css";
import NotFoundScreen from "@/components/NotFoundScreen";

export const metadata: Metadata = {
    title: "Página no encontrada · CSCloudSolutions FinOps",
};

/**
 * 404 para URLs que no matchean ninguna ruta.
 *
 * Renderiza bajo el layout raíz (passthrough), así que aporta su propio
 * <html>/<body> y su import de globals.css: acá no llega el árbol de
 * [locale]/layout.tsx.
 *
 * Por lo mismo queda fuera del NextIntlClientProvider y no hay locale en el
 * request, así que los textos van en el idioma por defecto (es). Traducirlos
 * exigiría adivinar el locale desde headers para una pantalla de error, que no
 * justifica la complejidad — la versión de [locale]/not-found.tsx sí traduce,
 * y es la que ve el usuario navegando dentro de la app.
 *
 * A diferencia del catch-all que se probó antes, esta ruta devuelve el status
 * 404 real: con el catch-all, Next respondía 200 y un link roto quedaba
 * indistinguible de una página válida para el monitoreo.
 */
export default function RootNotFound() {
    return (
        <html lang="es" suppressHydrationWarning>
            <body className="font-sans antialiased">
                <NotFoundScreen
                    homeHref="/"
                    labels={{
                        code: "Error 404",
                        title: "Página no encontrada",
                        description:
                            "La dirección que intentaste abrir no existe o fue movida. Puede que el enlace esté desactualizado, o que ya no tengas acceso a esa sección.",
                        goHome: "Volver al inicio",
                        supportHint: "¿Creés que es un error?",
                        supportLink: "Escribinos a soporte",
                        tagline: "Cloud Management Platform",
                    }}
                />
            </body>
        </html>
    );
}
