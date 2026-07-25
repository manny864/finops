'use client';

import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';

/**
 * Las tres pantallas que consumen un token de un solo uso mandado por email:
 *  - verify   -> confirma el email (POST, sin formulario)
 *  - reset    -> elige contraseña nueva (PUT /password-reset)
 *  - invite   -> el invitado activa su cuenta (PUT /invite)
 *
 * Se unifican porque sólo difieren en el endpoint, el verbo y si piden
 * contraseña. Tres archivos casi idénticos era peor.
 */

type Mode = 'verify' | 'reset' | 'invite';

const ENDPOINTS: Record<Mode, { url: string; method: string; needsPassword: boolean }> = {
    verify: { url: '/api/auth/local/verify-email', method: 'POST', needsPassword: false },
    reset: { url: '/api/auth/local/password-reset', method: 'PUT', needsPassword: true },
    invite: { url: '/api/auth/local/invite', method: 'PUT', needsPassword: true },
};

/** Espejo de PASSWORD_MIN_LENGTH en src/lib/localAuth.ts. El server revalida igual. */
const PASSWORD_MIN_LENGTH = 12;

export default function AuthTokenPageClient({ mode }: { mode: Mode }) {
    const t = useTranslations('authToken');
    const searchParams = useSearchParams();
    const token = searchParams.get('token') || '';
    const config = ENDPOINTS[mode];

    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState('');
    const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
    const [error, setError] = useState<string | null>(null);

    const submit = React.useCallback(async (body: Record<string, unknown>) => {
        setStatus('loading');
        setError(null);
        try {
            const res = await fetch(config.url, {
                method: config.method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token, ...body }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                setError(data.error || t('genericError'));
                setStatus('error');
                return;
            }
            setStatus('done');
        } catch {
            setError(t('genericError'));
            setStatus('error');
        }
    }, [config.url, config.method, token, t]);

    // La verificación de email no tiene nada que preguntar: se dispara sola al
    // abrir el link. Las otras dos esperan a que el usuario elija contraseña.
    useEffect(() => {
        if (mode === 'verify' && token && status === 'idle') submit({});
    }, [mode, token, status, submit]);

    const handlePasswordSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (password !== confirm) {
            setError(t('passwordMismatch'));
            return;
        }
        if (password.length < PASSWORD_MIN_LENGTH) {
            setError(t('passwordTooShort', { min: PASSWORD_MIN_LENGTH }));
            return;
        }
        submit({ password });
    };

    const shell = (children: React.ReactNode) => (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-slate-950 px-4 py-12">
            <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl shadow-sm p-8">
                {children}
            </div>
        </div>
    );

    if (!token) {
        return shell(
            <>
                <h1 className="text-xl font-bold text-gray-900 dark:text-white">{t('invalidTitle')}</h1>
                <p className="mt-2 text-sm text-gray-600 dark:text-slate-400">{t('missingToken')}</p>
            </>
        );
    }

    if (status === 'done') {
        return shell(
            <>
                <h1 className="text-xl font-bold text-gray-900 dark:text-white">{t(`${mode}.successTitle`)}</h1>
                <p className="mt-2 text-sm text-gray-600 dark:text-slate-400">{t(`${mode}.successBody`)}</p>
                <Link
                    href="/login"
                    className="mt-6 inline-block w-full text-center bg-[#0054A6] hover:bg-[#004080] text-white px-5 py-3 rounded-lg text-sm font-semibold"
                >
                    {t('goToSignIn')}
                </Link>
            </>
        );
    }

    if (mode === 'verify') {
        return shell(
            <>
                <h1 className="text-xl font-bold text-gray-900 dark:text-white">
                    {status === 'error' ? t('invalidTitle') : t('verify.pendingTitle')}
                </h1>
                <p className="mt-2 text-sm text-gray-600 dark:text-slate-400">
                    {status === 'error' ? error : t('verify.pendingBody')}
                </p>
                {status === 'error' && (
                    <Link href="/login" className="mt-6 inline-block text-sm text-[#0054A6] dark:text-blue-400 hover:underline">
                        {t('goToSignIn')}
                    </Link>
                )}
            </>
        );
    }

    return shell(
        <>
            <h1 className="text-xl font-bold text-gray-900 dark:text-white">{t(`${mode}.formTitle`)}</h1>
            <p className="mt-2 text-sm text-gray-600 dark:text-slate-400">
                {t('passwordHint', { min: PASSWORD_MIN_LENGTH })}
            </p>

            <form onSubmit={handlePasswordSubmit} className="mt-6 space-y-4">
                <div>
                    <label htmlFor="password" className="block text-sm font-medium text-gray-700 dark:text-slate-300">
                        {t('newPassword')}
                    </label>
                    <input
                        id="password"
                        type="password"
                        autoComplete="new-password"
                        required
                        minLength={PASSWORD_MIN_LENGTH}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-900 dark:text-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0054A6]"
                    />
                </div>
                <div>
                    <label htmlFor="confirm" className="block text-sm font-medium text-gray-700 dark:text-slate-300">
                        {t('confirmPassword')}
                    </label>
                    <input
                        id="confirm"
                        type="password"
                        autoComplete="new-password"
                        required
                        value={confirm}
                        onChange={(e) => setConfirm(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-900 dark:text-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0054A6]"
                    />
                </div>

                {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}

                <button
                    type="submit"
                    disabled={status === 'loading'}
                    className="w-full bg-gray-900 dark:bg-white dark:text-slate-900 text-white px-5 py-3 rounded-lg text-sm font-semibold transition-all active:scale-95 disabled:opacity-50"
                >
                    {status === 'loading' ? t('loading') : t('save')}
                </button>
            </form>
        </>
    );
}
