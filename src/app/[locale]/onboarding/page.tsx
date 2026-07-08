'use client';

import React, { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useTenant } from '@/components/TenantProvider';
import { isMockTenant } from '@/lib/mockData';
import { useMsal } from '@azure/msal-react';
import { fetchWithAuthRetry } from '@/lib/msalToken';
import WizardLayout from '@/components/onboarding/WizardLayout';
import WizardStep, { StepStatus } from '@/components/onboarding/WizardStep';
import { Loader2, CheckCircle2, AlertCircle } from 'lucide-react';

interface Progress {
    step_welcome: StepStatus;
    step_azure_sp: StepStatus;
    step_first_sync: StepStatus;
    step_first_budget: StepStatus;
    step_notifications: StepStatus;
    percent_complete: number;
}

export default function OnboardingPage() {
    const router = useRouter();
    const { locale } = useParams();
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();

    const [progress, setProgress] = useState<Progress | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [activeStep, setActiveStep] = useState<number>(1);

    const [companyName, setCompanyName] = useState('');
    const [primaryCloud, setPrimaryCloud] = useState('azure');
    const [currency, setCurrency] = useState('USD');
    const [timezone, setTimezone] = useState('UTC');
    const [clientId, setClientId] = useState('');
    const [clientSecret, setClientSecret] = useState('');
    const [azureTenantId, setAzureTenantId] = useState('');
    const [spValidating, setSpValidating] = useState(false);
    const [spValidationResult, setSpValidationResult] = useState<any>(null);
    const [syncRunning, setSyncRunning] = useState(false);
    const [budgetName, setBudgetName] = useState('');
    const [budgetLimit, setBudgetLimit] = useState('');
    const [budgetAlertThreshold, setBudgetAlertThreshold] = useState('80');

    useEffect(() => {
        if (!selectedTenant || !accounts.length) return;
        loadProgress();
    }, [selectedTenant, accounts]);

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
            }
        } catch (error) {
            console.error('[Onboarding] Failed to validate SP:', error);
        } finally {
            setSpValidating(false);
        }
    };

    const handleRunFirstSync = async () => {
        setSyncRunning(true);
        try {
            const response = await fetchWithAuthRetry(
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
        } finally {
            setSyncRunning(false);
        }
    };

    const handleCreateBudget = async () => {
        try {
            setSaving(true);
            const response = await fetchWithAuthRetry(
                instance,
                accounts[0],
                '/api/intelligence/budgets',
                {
                    method: 'POST',
                    body: JSON.stringify({
                        name: budgetName,
                        monthly_limit: budgetLimit,
                        alert_threshold_percent: budgetAlertThreshold,
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
            const response = await fetchWithAuthRetry(
                instance,
                accounts[0],
                '/api/onboarding/finish',
                {
                    method: 'POST',
                }
            );
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
            title="Welcome to CSCloudSolutions FinOps"
            description="Complete these steps to get started"
            progressPercent={progress.percent_complete}
            onSkipWizard={() => router.push(`/${locale}`)}
        >
            <div className="space-y-6">
                <WizardStep
                    stepNumber={1}
                    title="Welcome & Company Info"
                    description="Confirm your company details and preferences"
                    status={progress.step_welcome}
                    isActive={activeStep === 1}
                    onStart={() => setActiveStep(1)}
                    onContinue={async () => {
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
                                Company Name
                            </label>
                            <input
                                type="text"
                                value={companyName}
                                onChange={(e) => setCompanyName(e.target.value)}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                                placeholder="Your company name"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Primary Cloud Provider
                            </label>
                            <select
                                value={primaryCloud}
                                onChange={(e) => setPrimaryCloud(e.target.value)}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                            >
                                <option value="azure">Azure (Connected)</option>
                                <option value="aws" disabled>
                                    AWS (Coming soon)
                                </option>
                            </select>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    Currency
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
                                    Timezone
                                </label>
                                <select
                                    value={timezone}
                                    onChange={(e) => setTimezone(e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                                >
                                    <option value="UTC">UTC</option>
                                    <option value="EST">EST (US Eastern)</option>
                                    <option value="CST">CST (US Central)</option>
                                    <option value="PST">PST (US Pacific)</option>
                                </select>
                            </div>
                        </div>
                    </div>
                </WizardStep>

                <WizardStep
                    stepNumber={2}
                    title="Connect Azure Subscription"
                    description="Provide your Service Principal credentials"
                    status={progress.step_azure_sp}
                    isActive={activeStep === 2}
                    onStart={() => setActiveStep(2)}
                    onContinue={handleValidateSP}
                    onSkip={async () => {
                        await updateStepStatus('step_azure_sp', 'skipped');
                        setActiveStep(3);
                    }}
                    actionLabel={spValidating ? 'Validating...' : 'Validate'}
                >
                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Client ID
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
                                Client Secret
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
                                Azure Tenant ID
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
                                                Credentials validated successfully
                                            </p>
                                            <p className="text-sm text-green-800 mt-1">
                                                All required permissions present
                                            </p>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="flex gap-2 items-start">
                                        <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                                        <div>
                                            <p className="font-medium text-red-900">
                                                {spValidationResult.error || 'Validation failed'}
                                            </p>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </WizardStep>

                <WizardStep
                    stepNumber={3}
                    title="Run First Data Sync"
                    description="Sync your first set of cost data from Azure"
                    status={progress.step_first_sync}
                    isActive={activeStep === 3}
                    onStart={handleRunFirstSync}
                    onSkip={async () => {
                        await updateStepStatus('step_first_sync', 'skipped');
                        setActiveStep(4);
                    }}
                    actionLabel={syncRunning ? 'Syncing...' : 'Run Sync'}
                >
                    {syncRunning ? (
                        <div className="flex items-center gap-3">
                            <Loader2 className="w-5 h-5 text-blue-600 animate-spin" />
                            <span className="text-sm text-gray-700">
                                Syncing your data... this may take up to 60 seconds
                            </span>
                        </div>
                    ) : (
                        <p className="text-sm text-gray-700">
                            Click "Run Sync" to import your initial cost data from Azure
                        </p>
                    )}
                </WizardStep>

                <WizardStep
                    stepNumber={4}
                    title="Create Your First Budget"
                    description="Set up a budget to track spending"
                    status={progress.step_first_budget}
                    isActive={activeStep === 4}
                    onStart={() => setActiveStep(4)}
                    onContinue={handleCreateBudget}
                    onSkip={async () => {
                        await updateStepStatus('step_first_budget', 'skipped');
                        setActiveStep(5);
                    }}
                    actionLabel={saving ? 'Creating...' : 'Create Budget'}
                >
                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Budget Name
                            </label>
                            <input
                                type="text"
                                value={budgetName}
                                onChange={(e) => setBudgetName(e.target.value)}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                                placeholder="e.g., Production Costs"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Monthly Limit ($)
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
                                Alert Threshold (%)
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
                    title="Set Up Notifications"
                    description="Configure how you want to receive alerts"
                    status={progress.step_notifications}
                    isActive={activeStep === 5}
                    onStart={() => setActiveStep(5)}
                    onContinue={() => setActiveStep(5)}
                    onSkip={async () => {
                        await updateStepStatus('step_notifications', 'skipped');
                    }}
                    actionLabel="Configure"
                >
                    <p className="text-sm text-gray-700 mb-4">
                        Add at least one notification channel to receive budget alerts
                    </p>
                    <a
                        href={`/${locale}/admin/notifications`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:text-blue-700 font-medium text-sm"
                    >
                        Open Notifications Settings →
                    </a>
                </WizardStep>

                <div className="flex gap-4 pt-4 border-t">
                    <button
                        onClick={handleFinishOnboarding}
                        disabled={saving}
                        className="flex-1 px-6 py-3 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 disabled:opacity-50 text-white font-bold rounded-lg transition-all"
                    >
                        {saving ? <Loader2 className="w-5 h-5 animate-spin inline mr-2" /> : null}
                        Finish Onboarding
                    </button>
                    <button
                        onClick={() => router.push(`/${locale}/admin/onboarding`)}
                        className="px-6 py-3 bg-gray-200 hover:bg-gray-300 text-gray-900 font-medium rounded-lg transition-colors"
                    >
                        Advanced Setup
                    </button>
                </div>
            </div>
        </WizardLayout>
    );
}
