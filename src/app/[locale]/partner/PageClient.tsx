"use client";

/**
 * Panel del afiliado. Sólo lectura, sin sesión de Entra ID.
 *
 * EL TOKEN VIAJA EN EL FRAGMENTO (`/partner#k=afp_live_…`) Y NO EN LA QUERY.
 * Esa es la parte que importa: el fragmento no se manda al servidor, así que el
 * token no aparece en los logs de acceso ni en la cabecera `Referer` hacia
 * ningún recurso externo. Una query string lo dejaría en los dos.
 *
 * ponytail: el token QUEDA VISIBLE en la barra de direcciones. Se intentó
 * sacarlo con `history.replaceState` (en el efecto y en el cuadro siguiente) y
 * con `router.replace`: el App Router repone el fragmento durante la
 * hidratación y las tres se pisan. Es el mismo trato que hace cualquier enlace
 * mágico, y el enlace ya está en el correo del partner de todos modos. Lo que
 * cubre el riesgo residual es que sea revocable desde el panel de superadmin.
 * Si algún día molesta de verdad, la salida es una ruta de intercambio que
 * canjee el token por una cookie httpOnly y redirija.
 *
 * Igual se guarda en `sessionStorage` —que muere al cerrar la pestaña— para que
 * el panel siga funcionando si el fragmento se pierde navegando dentro del sitio.
 */

import React, { useEffect, useRef, useState } from "react";
import { useTranslations, useLocale } from "next-intl";

const CLAVE_SESION = "cscs.partner.k";

interface Referido {
    empresa: string; desde: string | null; comisionaHasta: string | null;
    cobros: number; acumulado: string;
}
interface Comision {
    empresa: string; fecha: string | null; base: string; moneda: string;
    pct: string; monto: string; estado: string;
}
interface Panel {
    nombre: string; codigo: string; pct: string; mesesDeComision: number;
    totales: { pendiente: string; pagado: string; moneda: string | null; referidos: number };
    referidos: Referido[]; comisiones: Comision[];
}

/** El token del fragmento, o el que quedó de esta sesión. */
function tomarToken(): { token: string | null } {
    if (typeof window === "undefined") return { token: null };
    const enHash = new URLSearchParams(window.location.hash.replace(/^#/, "")).get("k");
    if (enHash) {
        // En modo privado o con el almacenamiento bloqueado esto tira: el panel
        // igual carga, sólo que se apoya en el fragmento para recargar.
        try { sessionStorage.setItem(CLAVE_SESION, enHash); } catch { /* sin sesión */ }
        return { token: enHash };
    }
    try { return { token: sessionStorage.getItem(CLAVE_SESION) }; } catch { return { token: null }; }
}

export default function PageClient() {
    const t = useTranslations("PartnerPanel");
    const locale = useLocale();
    // El arranque corre UNA vez: sin esto, un cambio de identidad de `t` volvería
    // a pedir el panel.
    const arrancado = useRef(false);
    const [panel, setPanel] = useState<Panel | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [cargando, setCargando] = useState(true);

    useEffect(() => {
        if (arrancado.current) return;
        arrancado.current = true;

        const { token } = tomarToken();
        if (!token) { setError(t("noLink")); setCargando(false); return; }
        fetch("/api/partner/panel", { headers: { Authorization: `Bearer ${token}` } })
            .then(async (r) => {
                if (!r.ok) throw new Error(r.status === 401 ? t("invalidLink") : t("loadError"));
                return r.json();
            })
            .then((d) => setPanel(d.panel))
            .catch((e) => setError(e.message || t("loadError")))
            .finally(() => setCargando(false));
    }, [t]);

    /**
     * EN UTC. Las fechas salen de columnas DATETIME que el pool lee con
     * `timezone: "Z"`, así que formatearlas en la zona del navegador corre el
     * día: "comisiona hasta el 4 de marzo" se dibujaba como el 3 desde
     * Argentina, y la fecha de corte de una comisión no puede bailar con el
     * huso de quien mira.
     */
    const fecha = (iso: string | null) =>
        iso ? new Date(iso).toLocaleDateString(locale, {
            day: "2-digit", month: "short", year: "numeric", timeZone: "UTC",
        }) : "—";
    const plata = (v: string, moneda: string | null) =>
        new Intl.NumberFormat(locale, { style: "currency", currency: moneda || "USD" }).format(Number(v) || 0);

    if (cargando) {
        return <Marco><p className="text-slate-500">{t("loading")}</p></Marco>;
    }
    if (error || !panel) {
        return (
            <Marco>
                <div className="rounded-xl border border-amber-300 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/30 p-5">
                    <p className="font-semibold text-amber-900 dark:text-amber-200">{error}</p>
                    <p className="mt-1 text-sm text-amber-800/80 dark:text-amber-300/70">{t("askForLink")}</p>
                </div>
            </Marco>
        );
    }

    const m = panel.totales.moneda;

    return (
        <Marco>
            <header className="space-y-1">
                <h1 className="text-2xl font-bold text-[#1B2A41] dark:text-slate-100">{t("title")}</h1>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                    {t("greeting", { name: panel.nombre })}
                </p>
            </header>

            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <Dato titulo={t("pending")} valor={plata(panel.totales.pendiente, m)} destacado />
                <Dato titulo={t("paid")} valor={plata(panel.totales.pagado, m)} />
                <Dato titulo={t("referrals")} valor={String(panel.totales.referidos)} />
                <Dato titulo={t("yourRate")} valor={`${Number(panel.pct)}%`} nota={t("firstYearOnly", { months: panel.mesesDeComision })} />
            </div>

            <section className="space-y-2">
                <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">{t("yourLink")}</h2>
                <code className="block rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 px-3 py-2 text-sm font-mono break-all text-[#0054A6] dark:text-sky-400">
                    https://finops.cscloudsolutions.com.ar/signup?ref={panel.codigo}
                </code>
            </section>

            <Tabla
                titulo={t("referralsTitle")}
                vacio={t("noReferrals")}
                columnas={[t("company"), t("since"), t("commissionsUntil"), t("charges"), t("accrued")]}
                filas={panel.referidos.map((r) => [
                    r.empresa, fecha(r.desde),
                    r.comisionaHasta ? fecha(r.comisionaHasta) : t("notStarted"),
                    String(r.cobros), plata(r.acumulado, m),
                ])}
            />

            <Tabla
                titulo={t("commissionsTitle")}
                vacio={t("noCommissions")}
                columnas={[t("company"), t("date"), t("base"), t("rate"), t("amount"), t("status")]}
                filas={panel.comisiones.map((c) => [
                    c.empresa, fecha(c.fecha), plata(c.base, c.moneda),
                    `${Number(c.pct)}%`, plata(c.monto, c.moneda), t(`status_${c.estado}`),
                ])}
            />

            <p className="text-xs text-slate-400 pt-2 border-t border-slate-100 dark:border-slate-800">
                {t("footnote")}
            </p>
        </Marco>
    );
}

function Marco({ children }: { children: React.ReactNode }) {
    return (
        <main className="min-h-screen bg-white dark:bg-slate-950 px-4 py-10">
            <div className="mx-auto max-w-4xl space-y-6">{children}</div>
        </main>
    );
}

function Dato({ titulo, valor, nota, destacado }: { titulo: string; valor: string; nota?: string; destacado?: boolean }) {
    return (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40 p-4">
            <span className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">{titulo}</span>
            <span className={`text-xl font-extrabold ${destacado ? "text-[#0078D4]" : "text-[#1B2A41] dark:text-slate-100"}`}>
                {valor}
            </span>
            {nota && <span className="block text-[11px] text-slate-400 mt-0.5">{nota}</span>}
        </div>
    );
}

function Tabla({ titulo, columnas, filas, vacio }: {
    titulo: string; columnas: string[]; filas: string[][]; vacio: string;
}) {
    return (
        <section className="space-y-2">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">{titulo}</h2>
            {filas.length === 0 ? (
                <p className="text-sm text-slate-400 py-4">{vacio}</p>
            ) : (
                <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
                    <table className="w-full text-sm">
                        <thead className="bg-slate-50 dark:bg-slate-900">
                            <tr>{columnas.map((c) => (
                                <th key={c} className="px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500">{c}</th>
                            ))}</tr>
                        </thead>
                        <tbody>
                            {filas.map((f, i) => (
                                <tr key={i} className="border-t border-slate-100 dark:border-slate-800">
                                    {f.map((v, j) => (
                                        <td key={j} className="px-3 py-2 text-slate-700 dark:text-slate-300 whitespace-nowrap">{v}</td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </section>
    );
}
