'use client';

import React, { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/routing';
import { saveLocalSession } from '@/lib/localSession';

/**
 * Formulario de email+contraseña para tenants con identidad propia (local
 * auth), sin pasar por Entra. Se monta DENTRO de la tarjeta de login que ya
 * renderiza ClientShell, debajo del botón de Microsoft — no en una página
 * aparte, porque ClientShell intercepta todas las rutas cuando no hay sesión
 * y una página paralela nunca llegaría a pintarse.
 */
export default function LocalLoginForm() {
    const t = useTranslations('login');
    const router = useRouter();

    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [showReset, setShowReset] = useState(false);

    const inputClass =
        'w-full rounded-[10px] bg-white/5 border border-white/10 text-white placeholder-[#566f8c] px-3 py-2.5 text-[14px] focus:outline-none focus:ring-2 focus:ring-brand-deep focus:border-transparent transition-all';

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setNotice(null);
        setLoading(true);
        try {
            const res = await fetch('/api/auth/local/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                setError(data.error || t('genericError'));
                return;
            }
            saveLocalSession({ token: data.token, email: data.email, tenantId: data.tenantId });
            // Recarga dura y no router.push: ClientShell decide qué renderizar a
            // partir de estado que se calcula al montar (isAuthenticated, tenant,
            // rol). Una navegación client-side lo dejaría con el estado viejo y
            // el usuario seguiría viendo la pantalla de login pese a tener token.
            window.location.href = '/';
        } catch {
            setError(t('genericError'));
        } finally {
            setLoading(false);
        }
    };

    const handleResetRequest = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setLoading(true);
        try {
            await fetch('/api/auth/local/password-reset', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email }),
            });
            // El endpoint responde igual exista o no la cuenta (anti-enumeración),
            // así que el mensaje de la UI también tiene que ser neutro.
            setNotice(t('resetSent'));
            setShowReset(false);
        } catch {
            setError(t('genericError'));
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="mt-6">
            <div className="flex items-center mb-5" role="separator">
                <div className="flex-grow border-t border-white/10" />
                <span className="px-3 text-[11px] uppercase tracking-[1.5px] text-[#566f8c] font-semibold">
                    {t('or')}
                </span>
                <div className="flex-grow border-t border-white/10" />
            </div>

            <form onSubmit={showReset ? handleResetRequest : handleLogin} className="space-y-3">
                <div>
                    <label htmlFor="local-email" className="sr-only">{t('email')}</label>
                    <input
                        id="local-email"
                        type="email"
                        autoComplete="email"
                        required
                        placeholder={t('email')}
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className={inputClass}
                    />
                </div>

                {!showReset && (
                    <div>
                        <label htmlFor="local-password" className="sr-only">{t('password')}</label>
                        <input
                            id="local-password"
                            type="password"
                            autoComplete="current-password"
                            required
                            placeholder={t('password')}
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            className={inputClass}
                        />
                    </div>
                )}

                {error && (
                    <p role="alert" className="text-[13px] text-red-400">{error}</p>
                )}
                {notice && (
                    <p role="status" className="text-[13px] text-emerald-400">{notice}</p>
                )}

                <button
                    type="submit"
                    disabled={loading}
                    className="w-full flex items-center justify-center py-[13px] px-4 rounded-[12px] text-[14px] font-bold text-white bg-white/10 hover:bg-white/15 border border-white/10 transition-all active:scale-[0.98] disabled:opacity-50 font-heading"
                >
                    {loading ? t('loading') : showReset ? t('sendResetLink') : t('signIn')}
                </button>
            </form>

            <button
                type="button"
                onClick={() => { setShowReset(!showReset); setError(null); setNotice(null); }}
                className="w-full mt-3 text-[12px] text-[#A9BBD0] hover:text-white transition-colors"
            >
                {showReset ? t('backToSignIn') : t('forgotPassword')}
            </button>
        </div>
    );
}
