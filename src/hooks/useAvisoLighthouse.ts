"use client";
import { useCallback } from "react";
import { useTranslations } from "next-intl";
import { LIGHTHOUSE_ERRORS } from "@/lib/lighthouseTier";

/**
 * El aviso "no disponible con Azure Lighthouse", en el idioma del usuario.
 *
 * La API lo manda como `errorCode` con un `error` en español de respaldo
 * (`AudienciaNoDelegadaError`). Las pantallas que leen el directorio del cliente
 * --M365, licencias, Entra ID, usuarios de Entra, Copilot M365-- lo traducen
 * acá en vez de mostrar el texto del servidor. Devuelve `null` si `json` trae
 * otro error, para que cada pantalla siga con su manejo de siempre.
 */
export function useAvisoLighthouse() {
    const t = useTranslations("Lighthouse");
    return useCallback(
        (json: { errorCode?: unknown } | null | undefined): string | null =>
            json?.errorCode === LIGHTHOUSE_ERRORS.NO_DELEGADO ? t("errores.ERR_LIGHTHOUSE_NOT_DELEGATED") : null,
        [t],
    );
}
