"use client";
import React, { useState } from 'react';
import { X, RefreshCw, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { errorMessage } from '@/lib/apiErrors';

export interface RenewReservation {
    reservationId: string;
    orderId: string;
    name: string;
    renew: boolean;
}

export default function ReservationRenewalModal({
    tenantId,
    reservation,
    authFetch,
    onClose,
    onUpdated,
}: {
    tenantId: string;
    reservation: RenewReservation;
    authFetch: (url: string, init?: RequestInit) => Promise<any>;
    onClose: () => void;
    onUpdated: (renew: boolean) => void;
}) {
    const t = useTranslations('Commitments');
    const [target, setTarget] = useState<boolean>(!reservation.renew);
    const [saving, setSaving] = useState(false);
    const [success, setSuccess] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const apply = async () => {
        setSaving(true);
        setError(null);
        try {
            await authFetch('/api/intelligence/commitments/reservations/renew', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    tenantId,
                    orderId: reservation.orderId,
                    reservationId: reservation.reservationId,
                    renew: target,
                }),
            });
            setSuccess(true);
            onUpdated(target);
            setTimeout(onClose, 1200);
        } catch (e) {
            setError(errorMessage(e) || t('renewalError'));
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
            <div
                className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-md p-6 border border-gray-200 dark:border-slate-700"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-start justify-between mb-4">
                    <h3 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                        <RefreshCw className="w-5 h-5 text-emerald-500" />
                        {t('renewalTitle')}
                    </h3>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 cursor-pointer">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">{t('renewalDescription')}</p>

                <div className="bg-gray-50 dark:bg-slate-800/60 rounded-lg p-3 mb-4 text-sm">
                    <div className="flex justify-between mb-1">
                        <span className="text-gray-500 dark:text-gray-400">{t('renewalReservation')}</span>
                        <span className="font-semibold text-gray-900 dark:text-white truncate max-w-[220px]" title={reservation.name}>{reservation.name}</span>
                    </div>
                    <div className="flex justify-between">
                        <span className="text-gray-500 dark:text-gray-400">{t('renewalCurrentState')}</span>
                        <span className={`font-semibold ${reservation.renew ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-500 dark:text-gray-400'}`}>
                            {reservation.renew ? t('renewalEnabled') : t('renewalDisabled')}
                        </span>
                    </div>
                </div>

                <div className="space-y-2 mb-4">
                    <label className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${target ? 'border-emerald-400 bg-emerald-50 dark:bg-emerald-900/20' : 'border-gray-200 dark:border-slate-700'}`}>
                        <input type="radio" name="renew-target" checked={target} onChange={() => setTarget(true)} className="accent-emerald-500" />
                        <span className="text-sm font-medium text-gray-900 dark:text-white">{t('renewalEnable')}</span>
                    </label>
                    <label className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${!target ? 'border-red-400 bg-red-50 dark:bg-red-900/20' : 'border-gray-200 dark:border-slate-700'}`}>
                        <input type="radio" name="renew-target" checked={!target} onChange={() => setTarget(false)} className="accent-red-500" />
                        <span className="text-sm font-medium text-gray-900 dark:text-white">{t('renewalDisable')}</span>
                    </label>
                </div>

                {error && (
                    <div className="flex items-center gap-2 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 p-2 rounded text-sm mb-3">
                        <AlertCircle className="w-4 h-4 shrink-0" /> {error}
                    </div>
                )}
                {success && (
                    <div className="flex items-center gap-2 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 p-2 rounded text-sm mb-3">
                        <CheckCircle2 className="w-4 h-4 shrink-0" /> {t('renewalSuccess')}
                    </div>
                )}

                <div className="flex justify-end gap-2">
                    <button onClick={onClose} disabled={saving} className="px-4 py-2 rounded-lg border border-gray-200 dark:border-slate-700 text-gray-700 dark:text-gray-200 text-sm font-semibold hover:bg-gray-50 dark:hover:bg-slate-800 cursor-pointer disabled:opacity-50">
                        {t('renewalCancel')}
                    </button>
                    <button
                        onClick={apply}
                        disabled={saving || success || target === reservation.renew}
                        className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold cursor-pointer disabled:opacity-50 flex items-center gap-2"
                    >
                        {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                        {saving ? t('renewalSaving') : t('renewalConfirm')}
                    </button>
                </div>
            </div>
        </div>
    );
}
