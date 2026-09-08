"use client";

import { useTranslations } from "next-intl";

/**
 * Forma minima que comparten las cinco familias de acciones de remediacion de
 * computo (VMSS, App Service, Function App, VM y ARO).
 */
export interface AccionConTexto {
    titleKey: string;
    descKey: string;
    params?: Record<string, string | number>;
}

/**
 * Titulo y descripcion traducidos de una recomendacion de computo.
 *
 * La API manda claves y no la frase armada porque el payload se cachea en Redis
 * con una clave que no incluye el locale: si el servidor armara el texto, el
 * segundo lector recibiria el idioma del primero.
 *
 * El try/catch no es decorativo. Si un payload viejo del cache no trae `params`
 * con lo que la clave interpola, `t()` tira FORMATTING_ERROR, y como esto corre
 * dentro de un render de React eso tumba el tablero entero (ya paso una vez con
 * los boards de base de datos). La version de la clave de cache subio a v2;
 * esto es la red por si algo se escapa.
 */
export function useTextoDeRecomendacion(): {
    titulo: (accion: AccionConTexto) => string;
    descripcion: (accion: AccionConTexto) => string;
} {
    const t = useTranslations("ComputeRecommendations");

    const resolver = (clave: string, params?: Record<string, string | number>): string => {
        if (!clave) return "";
        try {
            return t(clave, params ?? {});
        } catch {
            return "";
        }
    };

    return {
        titulo: (accion) => resolver(accion.titleKey, accion.params),
        descripcion: (accion) => resolver(accion.descKey, accion.params),
    };
}
