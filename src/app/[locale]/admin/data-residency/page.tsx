"use client";
import React, { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { useTenant } from '@/components/TenantProvider';
import { useMsal } from '@azure/msal-react';
import { Globe, Lock } from 'lucide-react';
import { toast } from 'sonner';
import { getFreshIdToken } from '@/lib/msalToken';

// Subprocesadores por región. La plataforma corre íntegramente sobre Microsoft
// Azure, así que hay un solo subprocesador de infraestructura por región.
// Hoy existe UN stamp desplegado (West US 2, ver infra/terraform); el resto son
// regiones candidatas y se marcan como tales para no prometer una capacidad que
// todavía no está desplegada.
const REGION_SUBPROCESSORS: Record<string, string[]> = {
    EU: ['Azure (Netherlands) — planned'],
    US: ['Azure (West US 2)'],
    LATAM: ['Azure (Brazil South) — planned'],
    APAC: ['Azure (Singapore) — planned'],
    GLOBAL: ['Azure (West US 2)'],
};

interface DataResidencyInfo {
    region: string;
    locked_at: string | null;
    can_change: boolean;
    available_regions: string[];
}

interface ResidencyChange {
    id?: number;
    from_region?: string;
    to_region: string;
    changed_by: string;
    reason?: string;
    created_at: string;
}

export default function DataResidencyPage() {
    const t = useTranslations('AdminDataResidency');
    const { selectedTenant, userRole, systemRole } = useTenant();
    const { instance, accounts } = useMsal();

    const REGIONS = [
        { code: 'EU', flag: '🇪🇺', label: t('regions.eu') },
        { code: 'US', flag: '🇺🇸', label: t('regions.us') },
        { code: 'LATAM', flag: '🌎', label: t('regions.latam') },
        { code: 'APAC', flag: '🌏', label: t('regions.apac') },
        { code: 'GLOBAL', flag: '🌐', label: t('regions.global') },
    ];

    const [residencyInfo, setResidencyInfo] = useState<DataResidencyInfo | null>(null);
    const [selectedRegion, setSelectedRegion] = useState<string>('');
    const [reason, setReason] = useState('');
    const [saving, setSaving] = useState(false);
    const [loading, setLoading] = useState(true);
    const [lockConfirm, setLockConfirm] = useState(false);
    const [changes, setChanges] = useState<ResidencyChange[]>([]);
    const [copied, setCopied] = useState(false);

    const isOwner = userRole === 'Admin' || systemRole === 'SUPERADMIN';
    const isLocked = residencyInfo?.locked_at;
    const loadChangeHistory = async () => {
        try {
            // In a real implementation, we'd fetch from an API endpoint
            // For now, we'll just initialize as empty
            setChanges([]);
        } catch (e) {
            console.error('Error loading change history:', e);
        }
    };
    const loadResidencyInfo = async () => {
        try {
            setLoading(true);
            const tokenResponse = { idToken: await getFreshIdToken(instance, accounts[0]) };

            const res = await fetch(
                `/api/admin/data-residency?tenantId=${selectedTenant?.id}`,
                {
                    headers: {
                        'Authorization': `Bearer ${tokenResponse.idToken}`,
                    },
                }
            );

            if (res.ok) {
                const data = await res.json();
                setResidencyInfo(data);
                setSelectedRegion(data.region);
                // Load change history
                loadChangeHistory();
            } else {
                const data = await res.json();
                toast.error(data.error || t('toasts.loadInfoFailed'));
            }
        } catch (e) {
            console.error('Error loading residency info:', e);
            toast.error(t('toasts.loadInfoError'));
        } finally {
            setLoading(false);
        }
    };


    useEffect(() => {
        if (!selectedTenant || selectedTenant.id === 'default') {
            setLoading(false);
            return;
        }
        loadResidencyInfo();
    }, [selectedTenant]);    const handleRegionChange = async () => {
        if (!selectedTenant || selectedTenant.id === 'default') {
            toast.error(t('toasts.selectTenantFirst'));
            return;
        }

        if (selectedRegion === residencyInfo?.region && !reason) {
            toast.error(t('toasts.selectDifferentRegion'));
            return;
        }

        if (isLocked && selectedRegion !== residencyInfo?.region) {
            toast.error(t('toasts.lockedContactSupport'));
            return;
        }

        setSaving(true);
        try {
            const tokenResponse = { idToken: await getFreshIdToken(instance, accounts[0]) };

            const res = await fetch('/api/admin/data-residency', {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${tokenResponse.idToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    tenantId: selectedTenant.id,
                    region: selectedRegion,
                    reason: reason || undefined,
                }),
            });

            if (res.ok) {
                toast.success(t('toasts.changedSuccess', { region: selectedRegion }));
                await loadResidencyInfo();
                setReason('');
                setLockConfirm(false);
            } else {
                const data = await res.json();
                toast.error(data.error || t('toasts.changeFailed'));
            }
        } catch (e) {
            console.error('Error changing residency:', e);
            toast.error(t('toasts.saveError'));
        } finally {
            setSaving(false);
        }
    };

    const handleLockRegion = async () => {
        if (!selectedTenant || selectedTenant.id === 'default') {
            toast.error(t('toasts.selectTenantFirst'));
            return;
        }

        if (!isOwner) {
            toast.error(t('toasts.ownerOnly'));
            return;
        }

        setSaving(true);
        try {
            const tokenResponse = { idToken: await getFreshIdToken(instance, accounts[0]) };

            const res = await fetch('/api/admin/data-residency/lock', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${tokenResponse.idToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ tenantId: selectedTenant.id }),
            });

            if (res.ok) {
                toast.success(t('toasts.lockSuccess'));
                await loadResidencyInfo();
                setLockConfirm(false);
            } else {
                const data = await res.json();
                toast.error(data.error || t('toasts.lockFailed'));
            }
        } catch (e) {
            console.error('Error locking region:', e);
            toast.error(t('toasts.lockError'));
        } finally {
            setSaving(false);
        }
    };

    if (!selectedTenant || selectedTenant.id === 'default') {
        return (
            <div className="p-6">
                <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4">
                    <p className="text-yellow-800">{t('selectTenantPrompt')}</p>
                </div>
            </div>
        );
    }

    if (loading) {
        return (
            <div className="p-6">
                <div className="animate-pulse">
                    <div className="h-8 w-48 bg-gray-200 rounded mb-4"></div>
                    <div className="h-32 bg-gray-200 rounded"></div>
                </div>
            </div>
        );
    }

    if (!residencyInfo) {
        return (
            <div className="p-6">
                <div className="rounded-lg border border-red-200 bg-red-50 p-4">
                    <p className="text-red-800">{t('loadFailed')}</p>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-6 p-6">
            {/* Header */}
            <div className="flex items-center gap-3">
                <Globe className="h-8 w-8 text-blue-600" />
                <div>
                    <h1 className="text-3xl font-bold">{t('pageTitle')}</h1>
                    <p className="text-gray-600">{t('pageSubtitle')}</p>
                </div>
            </div>

            {/* Current Region Card */}
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-6">
                <div className="flex items-start justify-between">
                    <div>
                        <p className="text-sm font-medium text-blue-600">{t('currentRegion')}</p>
                        <div className="mt-2 flex items-center gap-2">
                            <span className="text-4xl">
                                {REGIONS.find(r => r.code === residencyInfo.region)?.flag}
                            </span>
                            <div>
                                <p className="text-2xl font-bold">
                                    {REGIONS.find(r => r.code === residencyInfo.region)?.label}
                                </p>
                                <p className="text-sm text-gray-600">
                                    {t('codeLabel')} <code className="font-mono">{residencyInfo.region}</code>
                                </p>
                            </div>
                        </div>
                    </div>
                    {isLocked && (
                        <div className="flex items-center gap-2 rounded bg-amber-100 px-3 py-2 text-amber-700">
                            <Lock className="h-4 w-4" />
                            <span className="text-sm font-medium">{t('locked')}</span>
                        </div>
                    )}
                </div>
                {isLocked && (
                    <p className="mt-4 text-xs text-gray-600">
                        {t('lockedSince', { date: new Date(residencyInfo.locked_at!).toLocaleDateString() })}
                    </p>
                )}
            </div>

            {/* Region Selector */}
            {!isLocked && isOwner && (
                <div className="rounded-lg border p-6">
                    <h2 className="mb-4 text-lg font-semibold">{t('selectNewRegion')}</h2>
                    <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
                        {REGIONS.map((region) => (
                            <button
                                key={region.code}
                                onClick={() => setSelectedRegion(region.code)}
                                className={`rounded-lg border-2 p-4 text-left transition-all ${
                                    selectedRegion === region.code
                                        ? 'border-blue-500 bg-blue-50'
                                        : 'border-gray-200 hover:border-gray-300'
                                }`}
                            >
                                <p className="text-3xl">{region.flag}</p>
                                <p className="mt-2 font-medium">{region.label}</p>
                                <p className="text-xs text-gray-600">{region.code}</p>
                            </button>
                        ))}
                    </div>

                    {/* Reason Field */}
                    <div className="mt-6">
                        <label className="block text-sm font-medium">
                            {t('reasonLabel')}
                        </label>
                        <textarea
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            placeholder={t('reasonPlaceholder')}
                            rows={3}
                            className="mt-2 w-full rounded border border-gray-300 p-3 text-sm"
                        />
                    </div>

                    {/* Action Buttons */}
                    <div className="mt-6 flex gap-3">
                        <button
                            onClick={handleRegionChange}
                            disabled={saving || selectedRegion === residencyInfo.region}
                            className="rounded bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                        >
                            {saving ? t('saving') : t('saveRegionChange')}
                        </button>
                    </div>
                </div>
            )}

            {isLocked && isOwner && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-800">
                    <p className="text-sm">
                        {t('lockedNotice')}
                    </p>
                </div>
            )}

            {/* Region Information */}
            <div className="rounded-lg border p-6">
                <h2 className="mb-4 text-lg font-semibold">{t('subprocessorsByRegion')}</h2>
                <div className="space-y-4">
                    {REGIONS.map((region) => (
                        <div
                            key={region.code}
                            className={`rounded-lg border p-4 ${
                                selectedRegion === region.code ? 'border-blue-300 bg-blue-50' : 'border-gray-200'
                            }`}
                        >
                            <div className="flex items-start gap-3">
                                <span className="text-2xl">{region.flag}</span>
                                <div className="flex-1">
                                    <p className="font-medium">{region.label}</p>
                                    <p className="text-sm text-gray-600 mt-1">
                                        {t('subprocessorsLabel')} {REGION_SUBPROCESSORS[region.code].join(', ')}
                                    </p>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
                <p className="mt-4 text-xs text-gray-600">
                    {t('subprocessorsFooter')}{' '}
                    <a href="/legal/subprocessors" className="text-blue-600 hover:underline">
                        {t('subprocessorsLinkText')}
                    </a>
                </p>
            </div>

            {/* Lock Section */}
            {isOwner && !isLocked && (
                <div className="rounded-lg border border-gray-200 p-6">
                    <h2 className="mb-2 text-lg font-semibold">{t('lockRegionPermanently')}</h2>
                    <p className="mb-4 text-sm text-gray-600">
                        {t('lockRegionDescription')}
                    </p>
                    {!lockConfirm ? (
                        <button
                            onClick={() => setLockConfirm(true)}
                            className="rounded border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-700 hover:bg-amber-100"
                        >
                            <Lock className="mr-2 inline h-4 w-4" />
                            {t('lockMyRegion')}
                        </button>
                    ) : (
                        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                            <p className="mb-4 font-medium text-amber-900">{t('areYouSure')}</p>
                            <p className="mb-4 text-sm text-amber-800">
                                {t('lockConfirmDescription')}
                            </p>
                            <div className="flex gap-3">
                                <button
                                    onClick={handleLockRegion}
                                    disabled={saving}
                                    className="rounded bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
                                >
                                    {saving ? t('locking') : t('confirmLock')}
                                </button>
                                <button
                                    onClick={() => setLockConfirm(false)}
                                    disabled={saving}
                                    className="rounded border border-amber-300 px-4 py-2 text-sm font-medium text-amber-700 hover:bg-amber-50"
                                >
                                    {t('cancel')}
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Info Box */}
            <div className="rounded-lg border border-blue-100 bg-blue-50 p-4 text-sm text-blue-900">
                <p className="font-medium mb-2">{t('aboutTitle')}</p>
                <p>
                    {t('aboutDescription')}
                </p>
            </div>
        </div>
    );
}
