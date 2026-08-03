'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useTenant } from '@/components/TenantProvider';
import { useSubscription } from '@/components/SubscriptionProvider';
import { isMockTenant } from '@/lib/mockData';
import { useMsal } from '@azure/msal-react';
import { fetchWithAuthRetry } from '@/lib/msalToken';
import WizardLayout from '@/components/onboarding/WizardLayout';
import WizardStep, { StepStatus } from '@/components/onboarding/WizardStep';
import { Loader2, CheckCircle2, AlertCircle, Handshake } from 'lucide-react';

interface Progress {
    step_welcome: StepStatus;
    step_azure_sp: StepStatus;
    step_first_sync: StepStatus;
    step_first_budget: StepStatus;
    step_notifications: StepStatus;
    percent_complete: number;
}

// Lista completa de zonas horarias IANA. Intl.supportedValuesOf está disponible
// en todos los navegadores modernos; si por alguna razón no lo estuviera, se cae
// a un subconjunto representativo para no romper el <select>.
const FALLBACK_TIMEZONES = [
    'UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
    'America/Sao_Paulo', 'America/Mexico_City', 'America/Argentina/Buenos_Aires',
    'Europe/London', 'Europe/Madrid', 'Europe/Paris', 'Europe/Berlin', 'Asia/Tokyo', 'Asia/Kolkata',
];

export default function OnboardingPage() {
    const router = useRouter();
    const { locale } = useParams();
    const t = useTranslations('OnboardingWizard');
    const { selectedTenant, setSelectedTenant } = useTenant();
    const { subscriptions } = useSubscription();
    const { instance, accounts } = useMsal();

    const [progress, setProgress] = useState<Progress | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [activeStep, setActiveStep] = useState<number>(1);

    const [companyName, setCompanyName] = useState('');
    const [primaryCloud, setPrimaryCloud] = useState('azure');
    const [currency, setCurrency] = useState('USD');
    const [timezone, setTimezone] = useState(() => {
        try {
            return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
        } catch {
            return 'UTC';
        }
    });
    const [clientId, setClientId] = useState('');
    const [clientSecret, setClientSecret] = useState('');
    const [azureTenantId, setAzureTenantId] = useState('');
    const [spValidating, setSpValidating] = useState(false);
    const [spValidationResult, setSpValidationResult] = useState<any>(null);
    const [syncRunning, setSyncRunning] = useState(false);
    const [partnerLinkBusy, setPartnerLinkBusy] = useState(false);
    const [budgetName, setBudgetName] = useState('');
    const [budgetLimit, setBudgetLimit] = useState('');
    const [budgetAlertThreshold, setBudgetAlertThreshold] = useState('80');
    const [budgetSubscription, setBudgetSubscription] = useState('All');
    const tenantProvider = selectedTenant?.provider;

    const timezones = useMemo<string[]>(() => {
        let list = FALLBACK_TIMEZONES;
        try {
            const fn = (Intl as any).supportedValuesOf;
            if (typeof fn === 'function') list = fn('timeZone') as string[];
        } catch {
            /* ignore */
        }
        // Intl.supportedValuesOf('timeZone') no incluye 'UTC' (usa 'Etc/UTC'),
        // pero el valor por defecto del estado es 'UTC'; lo anteponemos para que
        // el <select> tenga una opción que coincida con el valor inicial.
        return list.includes('UTC') ? list : ['UTC', ...list];
    }, []);

    useEffect(() => {
        if (!selectedTenant || !accounts.length) return;
        loadProgress();
    }, [selectedTenant, accounts]);

    useEffect(() => {
        if (tenantProvider === 'azure') {
            setPrimaryCloud(tenantProvider);
        }
    }, [tenantProvider]);

    // DEMO: precargar el formulario de onboarding con datos ya completados.
    // En modo demo no hay cuentas MSAL, por lo que loadProgress() nunca corre;
    // aquí rellenamos todos los campos y marcamos el wizard como 100% completado.
    useEffect(() => {
        if (!selectedTenant || !isMockTenant(selectedTenant.id)) return;
        setCompanyName(selectedTenant.name || 'Contoso Demo');
        setPrimaryCloud('azure');
        setCurrency('USD');
        setTimezone('UTC');
        setClientId('a1b2c3d4-1111-2222-3333-9f9f9f9f9f9f');
        setClientSecret('demo-secret-oculto-1234567890');
        setAzureTenantId('54d7cf18-0baa-4da7-8242-fbf59a92aaac');
        setBudgetName('Producción Cloud');
        setBudgetLimit('5000');
        setBudgetAlertThreshold('80');
        setSpValidationResult({ success: true, allPermissionsPresent: true });
        setProgress({
            step_welcome: 'completed',
            step_azure_sp: 'completed',
            step_first_sync: 'completed',
            step_first_budget: 'completed',
            step_notifications: 'completed',
            percent_complete: 100,
        });
        setActiveStep(5);
        setLoading(false);
    }, [selectedTenant]);

    const loadProgress = async () => {
        if (!accounts.length) return;
        try {
            const response = await fetchWithAuthRetry(
                instance,
                accounts[0],
                '/api/onboarding/progress'
            );
            const data = await response.json();
            setProgress(data);
            if (selectedTenant && 'company_name' in selectedTenant && selectedTenant.company_name) {
                setCompanyName(selectedTenant.company_name as string);
            }
        } catch (error) {
            console.error('[Onboarding] Failed to load progress:', error);
        } finally {
            setLoading(false);
        }
    };

    /** Persiste la zona horaria elegida en el paso 1. Antes este `<select>`
     *  existía pero su valor se descartaba: no había columna ni endpoint donde
     *  guardarlo. La zona gobierna cómo se muestran las fechas de la app y es
     *  el default de los horarios de Power Schedules. */
    const saveTenantTimezone = async () => {
        if (!selectedTenant?.id || !timezone) return;
        try {
            await fetchWithAuthRetry(instance, accounts[0], '/api/admin/tenant-settings', {
                method: 'PUT',
                body: JSON.stringify({ tenantId: selectedTenant.id, timezone }),
            });
        } catch (error) {
            // No bloquea el onboarding: la zona queda en el default y se puede
            // cambiar después desde la configuración del tenant.
            console.error('[Onboarding] Failed to save timezone:', error);
        }
    };

    const updateStepStatus = async (step: string, status: StepStatus) => {
        try {
            setSaving(true);
            const response = await fetchWithAuthRetry(
                instance,
                accounts[0],
                '/api/onboarding/progress',
                {
                    method: 'PUT',
                    body: JSON.stringify({ step, status }),
                }
            );
            const data = await response.json();
            setProgress(data);
        } catch (error) {
            console.error('[Onboarding] Failed to update step:', error);
        } finally {
            setSaving(false);
        }
    };

    const handleValidateSP = async () => {
        setSpValidating(true);
        try {
            const response = await fetchWithAuthRetry(
                instance,
                accounts[0],
                '/api/admin/diagnose-sp',
                {
                    method: 'POST',
                    body: JSON.stringify({
                        client_id: clientId,
                        client_secret: clientSecret,
                        tenant_id: azureTenantId,
                    }),
                }
            );
            const data = await response.json();
            setSpValidationResult(data);
            if (data.success || data.allPermissionsPresent) {
                await updateStepStatus('step_azure_sp', 'completed');
                setActiveStep(3);
            }
        } catch (error) {
            console.error('[Onboarding] Failed to validate SP:', error);
        } finally {
            setSpValidating(false);
        }
    };

    const handleValidateCloudConnection = async () => {
        if (!selectedTenant?.id) return;
        await handleValidateSP();
    };

    const handlePartnerLink = async (approve: boolean) => {
        if (!selectedTenant?.id) return;
        setPartnerLinkBusy(true);
        try {
            const response = await fetchWithAuthRetry(
                instance,
                accounts[0],
                '/api/tenants/partner-link',
                {
                    method: 'POST',
                    body: JSON.stringify({ tenantId: selectedTenant.id, approve }),
                }
            );
            const data = await response.json();
            if (!response.ok) {
                alert(data.error || t('partnerLinkError'));
                return;
            }
            setSelectedTenant({ ...selectedTenant, partner_link_status: data.status, partner_link_detail: data.detail || null });
        } catch (error) {
            console.error('[Onboarding] Partner link failed:', error);
        } finally {
            setPartnerLinkBusy(false);
        }
    };

    const handleRunFirstSync = async () => {
        setSyncRunning(true);
        try {
            await fetchWithAuthRetry(
                instance,
                accounts[0],
                '/api/admin/sync/trigger',
                {
                    method: 'POST',
                }
            );
            await new Promise((resolve) => setTimeout(resolve, 2000));
            await updateStepStatus('step_first_sync', 'completed');
            setActiveStep(4);
        } catch (error) {
            console.error('[Onboarding] Sync trigger failed:', error);
            await updateStepStatus('step_first_sync', 'completed');
            setActiveStep(4);
        } finally {
            setSyncRunning(false);
        }
    };

    const handleCreateBudget = async () => {
        try {
            setSaving(true);
            // El presupuesto se identifica por su Cost Center (cost_center_tag_value);
            // usamos el nombre ingresado como valor de centro de costo. La suscripción
            // seleccionada da contexto de a qué scope aplica el presupuesto.
            const response = await fetchWithAuthRetry(
                instance,
                accounts[0],
                '/api/budgets',
                {
                    method: 'POST',
                    body: JSON.stringify({
                        tenantId: selectedTenant?.id,
                        costCenter: budgetName,
                        monthlyLimit: Number(budgetLimit),
                        alertThreshold: Number(budgetAlertThreshold),
                        subscriptionId: budgetSubscription,
                    }),
                }
            );
            if (response.ok) {
                await updateStepStatus('step_first_budget', 'completed');
                setActiveStep(5);
            }
        } catch (error) {
            console.error('[Onboarding] Failed to create budget:', error);
        } finally {
            setSaving(false);
        }
    };

    const handleFinishOnboarding = async () => {
        try {
            setSaving(true);
            // Tenants demo/mock no tienen fila real en Onboarding/Tenants: saltar
            // la llamada al backend (fallaría o sería un no-op) y navegar directo.
            if (!selectedTenant || !isMockTenant(selectedTenant.id)) {
                await fetchWithAuthRetry(
                    instance,
                    accounts[0],
                    '/api/onboarding/finish',
                    {
                        method: 'POST',
                    }
                );
            }
            // El dashboard vive en la raíz del locale (/${locale}), NO en
            // /${locale}/overview (que solo tiene subrutas y daba 404 al finalizar).
            router.push(`/${locale}?onboarding_success=true`);
        } catch (error) {
            console.error('[Onboarding] Failed to finish:', error);
        } finally {
            setSaving(false);
        }
    };

    if (loading || !progress) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
            </div>
        );
    }

    return (
        <WizardLayout
            title={t('headerTitle')}
            description={t('headerDescription')}
            progressPercent={progress.percent_complete}
            onSkipWizard={() => router.push(`/${locale}`)}
        >
            <div className="space-y-6">
                <WizardStep
                    stepNumber={1}
                    title={t('step1Title')}
                    description={t('step1Desc')}
                    status={progress.step_welcome}
                    isActive={activeStep === 1}
                    onStart={() => setActiveStep(1)}
                    onContinue={async () => {
                        await saveTenantTimezone();
                        await updateStepStatus('step_welcome', 'completed');
                        setActiveStep(2);
                    }}
                    onSkip={async () => {
                        await updateStepStatus('step_welcome', 'skipped');
                        setActiveStep(2);
                    }}
                >
                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                {t('companyName')}
                            </label>
                            <input
                                type="text"
                                value={companyName}
                                onChange={(e) => setCompanyName(e.target.value)}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                                placeholder={t('companyNamePlaceholder')}
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    {t('currency')}
                                </label>
                                <select
                                    value={currency}
                                    onChange={(e) => setCurrency(e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                                >
                                    <option value="USD">USD ($)</option>
                                    <option value="EUR">EUR (€)</option>
                                    <option value="GBP">GBP (£)</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    {t('timezone')}
                                </label>
                                <select
                                    value={timezone}
                                    onChange={(e) => setTimezone(e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                                >
                                    {timezones.map((tz) => (
                                        <option key={tz} value={tz}>
                                            {tz}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>
                    </div>
                </WizardStep>

                <WizardStep
                    stepNumber={2}
                    title={t('step2Title')}
                    description={t('step2Desc')}
                    status={progress.step_azure_sp}
                    isActive={activeStep === 2}
                    onStart={() => setActiveStep(2)}
                    onContinue={handleValidateCloudConnection}
                    onSkip={async () => {
                        await updateStepStatus('step_azure_sp', 'skipped');
                        setActiveStep(3);
                    }}
                    actionLabel={spValidating ? t('validating') : t('validate')}
                >
                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                {t('clientId')}
                            </label>
                            <input
                                type="text"
                                value={clientId}
                                onChange={(e) => setClientId(e.target.value)}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg font-mono text-sm"
                                placeholder="XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                {t('clientSecret')}
                            </label>
                            <input
                                type="password"
                                value={clientSecret}
                                onChange={(e) => setClientSecret(e.target.value)}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg font-mono text-sm"
                                placeholder="••••••••••••••••"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                {t('azureTenantId')}
                            </label>
                            <input
                                type="text"
                                value={azureTenantId}
                                onChange={(e) => setAzureTenantId(e.target.value)}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg font-mono text-sm"
                                placeholder="XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX"
                            />
                        </div>
                        {spValidationResult && (
                            <div
                                className={`p-3 rounded-lg ${
                                    spValidationResult.success
                                        ? 'bg-green-50 border border-green-200'
                                        : 'bg-red-50 border border-red-200'
                                }`}
                            >
                                {spValidationResult.success ? (
                                    <div className="flex gap-2 items-start">
                                        <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                                        <div>
                                            <p className="font-medium text-green-900">
                                                {t('credsValidated')}
                                            </p>
                                            <p className="text-sm text-green-800 mt-1">
                                                {t('allPermsPresent')}
                                            </p>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="flex gap-2 items-start">
                                        <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                                        <div>
                                            <p className="font-medium text-red-900">
                                                {spValidationResult.error || t('validationFailed')}
                                            </p>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {selectedTenant?.has_client_secret && selectedTenant.partner_link_status !== 'LINKED' && (
                            <div className="p-4 rounded-lg bg-blue-50 border border-blue-200 space-y-3">
                                <p className="text-xs font-semibold text-gray-700 flex items-center gap-2">
                                    <Handshake className="w-4 h-4 text-blue-600" /> Asociación de partner (PAL / CPOR)
                                </p>
                                <p className="text-xs text-gray-600">
                                    CSCloudSolutions es partner de Microsoft. Si lo aprobás, asociaremos nuestro
                                    Partner ID a las credenciales que configuraste vía PAL
                                    (Partner Admin Link) y podremos registrar la relación de partner (CPOR) en
                                    Partner Center. Esto no otorga acceso adicional a tus datos ni tiene costo: solo le
                                    indica a Microsoft que somos tu partner de servicios de FinOps. Microsoft puede
                                    notificarte del reclamo CPOR y podés desasociarlo cuando quieras desde Azure.
                                </p>
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => handlePartnerLink(true)}
                                        disabled={partnerLinkBusy}
                                        className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg disabled:opacity-50"
                                    >
                                        {partnerLinkBusy ? 'Asociando…' : 'Aprobar asociación'}
                                    </button>
                                    <button
                                        onClick={() => handlePartnerLink(false)}
                                        disabled={partnerLinkBusy}
                                        className="px-3 py-1.5 border border-gray-300 text-gray-700 text-xs font-semibold rounded-lg hover:bg-gray-50 disabled:opacity-50"
                                    >
                                        No, gracias
                                    </button>
                                </div>
                            </div>
                        )}
                        {selectedTenant?.partner_link_status && selectedTenant.partner_link_status !== 'NONE' && (
                            <p className="text-xs text-gray-500">
                                Asociación de partner:{" "}
                                <span className={
                                    selectedTenant.partner_link_status === 'LINKED' ? 'text-green-600 font-semibold'
                                    : selectedTenant.partner_link_status === 'FAILED' ? 'text-red-600 font-semibold'
                                    : 'text-gray-700 font-semibold'
                                }>
                                    {selectedTenant.partner_link_status === 'LINKED' ? 'vinculada (PAL)'
                                        : selectedTenant.partner_link_status === 'APPROVED' ? 'aprobada'
                                        : selectedTenant.partner_link_status === 'FAILED' ? 'aprobada, link con error'
                                        : selectedTenant.partner_link_status === 'DECLINED' ? 'rechazada'
                                        : selectedTenant.partner_link_status}
                                </span>
                                {selectedTenant.partner_link_detail ? ` — ${selectedTenant.partner_link_detail}` : ""}
                            </p>
                        )}
                    </div>
                </WizardStep>

                <WizardStep
                    stepNumber={3}
                    title={t('step3Title')}
                    description={t('step3Desc')}
                    status={progress.step_first_sync}
                    isActive={activeStep === 3}
                    onStart={() => setActiveStep(3)}
                    onContinue={handleRunFirstSync}
                    onSkip={async () => {
                        await updateStepStatus('step_first_sync', 'skipped');
                        setActiveStep(4);
                    }}
                    actionLabel={syncRunning ? t('syncing') : t('runSync')}
                >
                    {syncRunning ? (
                        <div className="flex items-center gap-3">
                            <Loader2 className="w-5 h-5 text-blue-600 animate-spin" />
                            <span className="text-sm text-gray-700">
                                {t('syncingHint')}
                            </span>
                        </div>
                    ) : (
                        <p className="text-sm text-gray-700">
                            {t('syncClickHint')}
                        </p>
                    )}
                </WizardStep>

                <WizardStep
                    stepNumber={4}
                    title={t('step4Title')}
                    description={t('step4Desc')}
                    status={progress.step_first_budget}
                    isActive={activeStep === 4}
                    onStart={() => setActiveStep(4)}
                    onContinue={handleCreateBudget}
                    onSkip={async () => {
                        await updateStepStatus('step_first_budget', 'skipped');
                        setActiveStep(5);
                    }}
                    actionLabel={saving ? t('creating') : t('createBudget')}
                >
                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                {t('subscription')}
                            </label>
                            <select
                                value={budgetSubscription}
                                onChange={(e) => setBudgetSubscription(e.target.value)}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                            >
                                <option value="All">{t('allSubscriptions')}</option>
                                {subscriptions.map((sub) => (
                                    <option key={sub.id} value={sub.id}>
                                        {sub.name}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                {t('budgetName')}
                            </label>
                            <input
                                type="text"
                                value={budgetName}
                                onChange={(e) => setBudgetName(e.target.value)}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                                placeholder={t('budgetNamePlaceholder')}
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                {t('monthlyLimit')}
                            </label>
                            <input
                                type="number"
                                value={budgetLimit}
                                onChange={(e) => setBudgetLimit(e.target.value)}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                                placeholder="5000"
                                min="0"
                                step="100"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                {t('alertThreshold')}
                            </label>
                            <input
                                type="number"
                                value={budgetAlertThreshold}
                                onChange={(e) => setBudgetAlertThreshold(e.target.value)}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                                placeholder="80"
                                min="0"
                                max="100"
                            />
                        </div>
                    </div>
                </WizardStep>

                <WizardStep
                    stepNumber={5}
                    title={t('step5Title')}
                    description={t('step5Desc')}
                    status={progress.step_notifications}
                    isActive={activeStep === 5}
                    onStart={() => setActiveStep(5)}
                    onContinue={async () => {
                        await updateStepStatus('step_notifications', 'completed');
                    }}
                    onSkip={async () => {
                        await updateStepStatus('step_notifications', 'skipped');
                    }}
                    actionLabel={t('markConfigured')}
                >
                    <p className="text-sm text-gray-700 mb-4">
                        {t('notifHint')}
                    </p>
                    <a
                        href={`/${locale}/admin/config#notifications-config`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:text-blue-700 font-medium text-sm"
                    >
                        {t('openNotifSettings')} →
                    </a>
                </WizardStep>

                <div className="flex gap-4 pt-4 border-t">
                    <button
                        onClick={handleFinishOnboarding}
                        disabled={saving}
                        className="flex-1 px-6 py-3 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 disabled:opacity-50 text-white font-bold rounded-lg transition-all"
                    >
                        {saving ? <Loader2 className="w-5 h-5 animate-spin inline mr-2" /> : null}
                        {t('finishOnboarding')}
                    </button>
                    <button
                        onClick={() => router.push(`/${locale}/admin/onboarding`)}
                        className="px-6 py-3 bg-gray-200 hover:bg-gray-300 text-gray-900 font-medium rounded-lg transition-colors"
                    >
                        {t('advancedSetup')}
                    </button>
                </div>
            </div>
        </WizardLayout>
    );
}
