import React from "react";

export interface NotFoundLabels {
    code: string;
    title: string;
    description: string;
    goHome: string;
    goBack?: string;
    supportHint: string;
    supportLink: string;
    tagline: string;
}

interface NotFoundScreenProps {
    labels: NotFoundLabels;
    /** Se resuelve distinto según quién renderice: Link de i18n o <a> plano. */
    homeHref: string;
    /** El botón "volver atrás" necesita JS; sólo lo pasa la versión cliente. */
    onGoBack?: () => void;
}

/**
 * Pantalla 404 de marca, compartida por las dos not-found del proyecto:
 *
 *  - src/app/[locale]/not-found.tsx — para notFound() lanzado por páginas
 *    reales. Renderiza dentro del shell y traduce con next-intl.
 *  - src/app/not-found.tsx — para URLs que no matchean ninguna ruta. Vive
 *    fuera del NextIntlClientProvider, así que pasa los textos fijos.
 *
 * Las dos necesitan el mismo aspecto pero tienen restricciones distintas
 * (i18n/navegación), de ahí que la presentación viva acá y cada una aporte sus
 * strings y su forma de enlazar.
 *
 * Fondo oscuro por decisión de marca, igual que el login y UnregisteredUserScreen:
 * el PNG del logo es plateado/azul metálico y sólo contrasta sobre oscuro.
 */
export default function NotFoundScreen({ labels, homeHref, onGoBack }: NotFoundScreenProps) {
    return (
        <div className="min-h-screen bg-gradient-to-br from-[#0B1523] via-[#1B2A41] to-[#0B1523] flex flex-col items-center justify-center px-4 py-12 relative overflow-hidden font-sans">
            {/* Halos ambientales de marca, el mismo recurso que usa el login */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
                <div className="absolute top-[-10%] left-[-10%] w-[45%] h-[45%] rounded-full bg-[#0054A6]/25 blur-[120px]" />
                <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] rounded-full bg-[#00AEEF]/15 blur-[110px]" />
            </div>

            <div className="text-center relative z-10 mb-8">
                <img
                    src="/CSCloudSolutions.png"
                    alt="CSCloudSolutions"
                    className="w-full max-w-[300px] h-auto object-contain mx-auto"
                />
                <p className="mt-1 text-[12px] tracking-[2px] text-[#62809c] uppercase font-semibold">
                    {labels.tagline}
                </p>
            </div>

            <div className="w-full max-w-lg relative z-10">
                <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-[20px] shadow-2xl shadow-black/50 overflow-hidden">
                    {/* Barra de acento con el degradado de marca */}
                    <div className="h-1 w-full bg-gradient-to-r from-[#0054A6] to-[#00AEEF]" />

                    <div className="px-6 sm:px-10 py-10 text-center">
                        <p className="text-[11px] font-semibold uppercase tracking-[3px] text-[#00AEEF] mb-3">
                            {labels.code}
                        </p>

                        {/* Marca de agua decorativa: se oculta al lector de pantalla */}
                        <p
                            aria-hidden="true"
                            className="font-heading font-extrabold leading-none text-[86px] sm:text-[110px] bg-gradient-to-b from-white/90 to-white/25 bg-clip-text text-transparent select-none"
                        >
                            404
                        </p>

                        <h1 className="mt-2 text-[20px] sm:text-[22px] font-bold text-white font-heading">
                            {labels.title}
                        </h1>
                        <p className="mt-3 text-sm text-slate-300/80 leading-relaxed">{labels.description}</p>

                        <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
                            <a
                                href={homeHref}
                                className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white bg-[#0054A6] hover:bg-[#004489] transition-colors shadow-lg shadow-[#0054A6]/25"
                            >
                                {labels.goHome}
                            </a>
                            {onGoBack && labels.goBack && (
                                <button
                                    type="button"
                                    onClick={onGoBack}
                                    className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-slate-200 bg-white/5 hover:bg-white/10 border border-white/10 transition-colors"
                                >
                                    {labels.goBack}
                                </button>
                            )}
                        </div>
                    </div>

                    <div className="border-t border-white/10 px-6 py-4 text-center">
                        <p className="text-xs text-slate-400">
                            {labels.supportHint}{" "}
                            <a
                                href="mailto:soporte@cscloudsolutions.com.ar?subject=Error%20404%20en%20FinOps"
                                className="font-semibold text-[#00AEEF] hover:underline"
                            >
                                {labels.supportLink}
                            </a>
                        </p>
                    </div>
                </div>
            </div>

            <p className="text-center text-[11px] text-slate-500 mt-8 tracking-wide relative z-10">
                &copy; {new Date().getFullYear()} CSCloudSolutions
            </p>
        </div>
    );
}
