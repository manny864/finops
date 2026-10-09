"use client";

import React, { useState } from "react";
import useSWR from "swr";
import InfoTooltip from "@/components/InfoTooltip";
import { errorMessage } from "@/lib/apiErrors";
import type { T } from "./common";

type Herramienta = "terraform" | "tofu" | "bicep";
type Plataforma = "github" | "azuredevops" | "gitlab";

const HERRAMIENTAS: Array<{ id: Herramienta; clave: string }> = [
    { id: "terraform", clave: "toolTerraform" },
    { id: "tofu", clave: "toolTofu" },
    { id: "bicep", clave: "toolBicep" },
];
const PLATAFORMAS: Array<{ id: Plataforma; clave: string }> = [
    { id: "github", clave: "platformGithub" },
    { id: "azuredevops", clave: "platformAzureDevOps" },
    { id: "gitlab", clave: "platformGitlab" },
];

const boton = (activo: boolean) =>
    `rounded-lg border px-3 py-1 text-xs font-medium transition-colors ${
        activo
            ? "border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900"
            : "border-slate-300 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-900"
    }`;

/**
 * Cómo conectar un pipeline (MEJ-20): el workflow listo para copiar, ya con la URL de la
 * plataforma y el SHA-256 del script puestos. Sólo pide el endpoint cuando está abierto.
 */
export default function SetupPanel({
    tenantId, esMock, locale, t, fetcher, abiertoInicial,
}: {
    tenantId: string;
    esMock: boolean;
    locale: string;
    t: T;
    fetcher: (url: string) => Promise<any>;
    abiertoInicial: boolean;
}) {
    const [abierto, setAbierto] = useState(abiertoInicial);
    const [tool, setTool] = useState<Herramienta>("terraform");
    const [plataforma, setPlataforma] = useState<Plataforma>("github");
    const [copiado, setCopiado] = useState(false);

    const { data, error, isLoading } = useSWR(
        abierto && tenantId
            ? `/api/governance/shift-left/setup?tenantId=${encodeURIComponent(tenantId)}&tool=${tool}${esMock ? "&mock=true" : ""}`
            : null,
        fetcher,
        { revalidateOnFocus: false }
    );

    const snippet: string = data?.snippets?.[plataforma] ?? "";

    async function copiar() {
        try {
            await navigator.clipboard.writeText(snippet);
            setCopiado(true);
            setTimeout(() => setCopiado(false), 2000);
        } catch {
            /* sin permiso de portapapeles: el texto sigue visible y seleccionable */
        }
    }

    return (
        <section className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <h2 className="text-sm font-semibold flex items-center gap-2">
                        {t("setupTitle")}
                        <InfoTooltip content={t("setupHashHelp")} />
                    </h2>
                    <p className="text-xs text-slate-500 mt-0.5">{t("setupSubtitle")}</p>
                </div>
                <button type="button" onClick={() => setAbierto(!abierto)} aria-expanded={abierto} className="text-xs text-slate-600 dark:text-slate-300 hover:underline shrink-0">
                    {abierto ? t("setupHide") : t("setupShow")}
                </button>
            </div>

            {abierto ? (
                <div className="space-y-3">
                    <ol className="text-xs text-slate-600 dark:text-slate-300 space-y-1 list-decimal pl-5">
                        <li>
                            {t("setupStep1")}{" "}
                            <a className="underline" href={`/${locale}/admin/integrations?tab=api-keys`}>{t("setupStep1Link")}</a>
                        </li>
                        <li>{t("setupStep2")}</li>
                        <li>{t("setupStep3")}</li>
                    </ol>

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                        <div className="flex items-center gap-1.5" role="group" aria-label={t("setupToolLabel")}>
                            <span className="text-xs text-slate-500 mr-1">{t("setupToolLabel")}</span>
                            {HERRAMIENTAS.map((h) => (
                                <button key={h.id} type="button" className={boton(tool === h.id)} aria-pressed={tool === h.id} onClick={() => setTool(h.id)}>
                                    {t(h.clave)}
                                </button>
                            ))}
                        </div>
                        <div className="flex items-center gap-1.5" role="tablist">
                            {PLATAFORMAS.map((p) => (
                                <button key={p.id} type="button" role="tab" className={boton(plataforma === p.id)} aria-selected={plataforma === p.id} onClick={() => setPlataforma(p.id)}>
                                    {t(p.clave)}
                                </button>
                            ))}
                        </div>
                    </div>

                    {isLoading ? <p className="text-xs text-slate-500">{t("setupLoading")}</p> : null}
                    {error ? <p className="text-xs text-red-600 dark:text-red-400">{t("setupError")}: {errorMessage(error)}</p> : null}

                    {snippet ? (
                        <div className="relative">
                            <button
                                type="button"
                                onClick={copiar}
                                className="absolute top-2 right-2 rounded-md bg-slate-800 text-white text-xs px-2 py-1 hover:bg-slate-700"
                            >
                                {copiado ? t("setupCopied") : t("setupCopy")}
                            </button>
                            <pre className="overflow-x-auto rounded-lg bg-slate-950 text-slate-100 text-xs p-3 pr-20 leading-relaxed" tabIndex={0}>
                                <code>{snippet}</code>
                            </pre>
                        </div>
                    ) : null}

                    {data?.sha256 ? (
                        <p className="text-[11px] text-slate-500 break-all">
                            {t("setupHash")}: <span className="font-mono">{data.sha256}</span>
                        </p>
                    ) : null}
                </div>
            ) : null}
        </section>
    );
}
