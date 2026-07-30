import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/routing';

/**
 * Barra común de las páginas legales.
 *
 * POR QUÉ EXISTE
 * Estas páginas son `min-h-screen` y no traían ninguna navegación propia. Para
 * un visitante SIN sesión —que es el caso normal: llega desde el pie de la
 * pantalla de precios— eran un callejón sin salida: sólo el botón atrás del
 * navegador. Y como se visitan fuera del shell autenticado (ver PUBLIC_ROUTES
 * en ClientShell), no hay sidebar ni header que las contenga.
 *
 * La barra da la salida y permite saltar entre los cinco documentos legales sin
 * volver al inicio. Con sesión, las páginas se siguen renderizando dentro del
 * shell, así que esto queda como una barra de contenido — no duplica el header.
 */

const LEGAL_LINKS = [
    { href: '/legal/privacy', key: 'privacy' },
    { href: '/legal/terms', key: 'terms' },
    { href: '/legal/dpa', key: 'dpa' },
    { href: '/legal/security', key: 'security' },
    { href: '/legal/subprocessors', key: 'subprocessors' },
] as const;

export default async function LegalLayout({
    children,
    params,
}: {
    children: React.ReactNode;
    params: Promise<{ locale: string }>;
}) {
    const { locale } = await params;
    const t = await getTranslations({ locale, namespace: 'Footer' });

    return (
        <div className="min-h-screen bg-white dark:bg-slate-950">
            <div className="border-b border-gray-200 dark:border-slate-800 bg-white/90 dark:bg-slate-900/90 backdrop-blur sticky top-0 z-30">
                <div className="max-w-5xl mx-auto px-6 py-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                    <Link
                        href="/"
                        className="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-200 hover:text-brand-deep transition-colors"
                    >
                        <img
                            src="/logo_29k.png"
                            alt="CSCloudSolutions"
                            className="w-5 h-5 object-contain"
                        />
                        {t('backToApp')}
                    </Link>

                    <nav className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs ml-auto">
                        {LEGAL_LINKS.map(({ href, key }) => (
                            <Link
                                key={href}
                                href={href}
                                className="text-gray-500 dark:text-gray-400 hover:text-brand-deep transition-colors"
                            >
                                {t(key)}
                            </Link>
                        ))}
                    </nav>
                </div>
            </div>

            {children}
        </div>
    );
}
