import type { MetadataRoute } from "next";

/**
 * PWA manifest (Fase 1 de la app móvil): hace la plataforma instalable desde
 * el navegador ("Agregar a pantalla de inicio") y la abre a pantalla completa
 * (display: standalone), sin barra del navegador.
 *
 * Sin service worker a propósito: Chrome ya no lo exige para instalar, y un
 * SW con cache mal versionado puede servir una app vieja tras cada deploy.
 * Si en Fase 2 se necesita offline/push, agregarlo con versionado explícito.
 */
export default function manifest(): MetadataRoute.Manifest {
    return {
        name: "CSCloud FinOps",
        short_name: "FinOps",
        description: "Plataforma FinOps para Azure de CSCloudSolutions",
        start_url: "/mobile",
        display: "standalone",
        background_color: "#0B1B2B",
        theme_color: "#0054A6",
        orientation: "portrait",
        icons: [
            { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
            { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
        ],
    };
}
