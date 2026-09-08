"use client";

import { useTranslations } from "next-intl";

/**
 * Forma minima que comparten las acciones de remediacion que traen su texto en
 * claves: las cinco familias de computo (VMSS, App Service, Function App, VM y
 * ARO) y las de storage.
 */
export interface AccionConTexto {
    titleKey: string;
    descKey: string;
    params?: Record<string, string | number>;
}

/**
 * Resuelve el texto de una recomendacion a partir de sus claves.
 *
 * La API manda claves y no la frase armada por dos razones. En computo el
 * payload se cachea en Redis con una clave que no incluye el locale: si el
 * servidor armara el texto, el segundo lector recibiria el idioma del primero.
 * En storage no hay cache de servidor, pero SWR sí cachea del lado del cliente y
 * `LanguageSwitcher` navega por SPA, asi que cambiar de idioma dejaba el payload
 * anterior en pantalla hasta la revalidacion. Mismo bug, otro cache.
 *
 * El try/catch no es decorativo. Si un payload viejo no trae `params` con lo que
 * la clave interpola, `t()` tira FORMATTING_ERROR, y como esto corre dentro de un
 * render de React eso tumba el tablero entero (ya paso, `eb33f2e`).
 *
 * `texto` es el resolvedor crudo, para las acciones con mas campos que titulo y
 * descripcion (storage suma el impacto y los pasos de implementacion).
 */
export function useTextoDeRecomendacion(namespace: string = "ComputeRecommendations"): {
    texto: (clave: string | undefined, params?: Record<string, string | number>) => string;
    titulo: (accion: AccionConTexto) => string;
    descripcion: (accion: AccionConTexto) => string;
} {
    const t = useTranslations(namespace);

    const texto = (clave: string | undefined, params?: Record<string, string | number>): string => {
        if (!clave) return "";
        try {
            return t(clave, params ?? {});
        } catch {
            return "";
        }
    };

    return {
        texto,
        titulo: (accion) => texto(accion.titleKey, accion.params),
        descripcion: (accion) => texto(accion.descKey, accion.params),
    };
}
