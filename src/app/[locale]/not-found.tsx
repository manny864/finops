"use client";

import React from "react";
import { useTranslations } from "next-intl";
import NotFoundScreen from "@/components/NotFoundScreen";

/**
 * 404 del segmento [locale]: cubre los notFound() que lanzan las páginas reales
 * (por ejemplo un detalle cuyo registro no existe). Renderiza dentro del shell
 * y con el idioma del usuario.
 *
 * Las URLs que no matchean NINGUNA ruta no llegan acá: las atiende
 * src/app/not-found.tsx, que además devuelve el status 404 correcto.
 */
export default function LocaleNotFound() {
    const t = useTranslations("NotFound");

    return (
        <NotFoundScreen
            homeHref="/"
            onGoBack={() => window.history.back()}
            labels={{
                code: t("code"),
                title: t("title"),
                description: t("description"),
                goHome: t("goHome"),
                goBack: t("goBack"),
                supportHint: t("supportHint"),
                supportLink: t("supportLink"),
                tagline: t("tagline"),
            }}
        />
    );
}
