'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useMsal } from '@azure/msal-react';
import useSWR from 'swr';
import { useTenant } from '@/components/TenantProvider';
import { getFreshIdToken } from '@/lib/msalToken';
import { IconChartPie, IconCheck, IconAlertCircle, IconLoader2 } from '@tabler/icons-react';

interface ResourceCategory {
    category: string;
    total: number;
    compliant: number;
    rate: number;
}

interface Initiative {
    id: string;
    name: string;
    status: 'compliant' | 'noncompliant';
    compliance: number;
    policies: number;
    affectedResources: number;
}

interface ComplianceData {
    success: boolean;
    mock: boolean;
    compliant: number;
    nonCompliant: number;
    complianceRate: number;
    resourceCategories: ResourceCategory[];
    initiatives: Initiative[];
}

export default function PolicyComplianceOverview() {
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();
    const t = useTranslations('Governance');
    const tMock = useTranslations('Mock');
    const [isClient, setIsClient] = useState(false);

    const fetcher = async (url: string) => {
        const token = await getFreshIdToken(instance, accounts[0]);
        const res = await fetch(url, {
            headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error('Failed to fetch');
        return res.json();
    };

    const { data, isLoading, error } = useSWR<ComplianceData>(
        selectedTenant?.id ? `/api/governance/policies/compliance-overview?tenantId=${selectedTenant.id}` : null,
        fetcher,
        { revalidateOnFocus: false }
    );

    useEffect(() => {
        setIsClient(true);
    }, []);

    if (!isClient) return null;
    if (!selectedTenant) return <div className="text-gray-500">{t('selectTenant')}</div>;
    if (isLoading) {
        return (
            <div className="flex items-center justify-center py-8">
                <IconLoader2 className="animate-spin text-blue-500" />
            </div>
        );
    }
    if (error || !data) {
        return <div className="text-red-500">{t('error')}</div>;
    }

    const compliant = Number(data?.compliant ?? 0);
    const nonCompliant = Number(data?.nonCompliant ?? 0);
    const resourceCategories = Array.isArray(data?.resourceCategories) ? data.resourceCategories : [];
    const initiatives = Array.isArray(data?.initiatives) ? data.initiatives : [];
    const mock = Boolean(data?.mock);
    const totalResources = compliant + nonCompliant;
    const complianceRate = totalResources > 0 ? (compliant / totalResources) * 100 : 0;
    const compliantAngle = totalResources > 0 ? (compliant / totalResources) * 360 : 0;

    return (
        <div className="space-y-6">
            {mock && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-900/20">
                    <span className="text-sm font-medium text-amber-800 dark:text-amber-200">{tMock('mockDataNotice')}</span>
                </div>
            )}

            {/* Pie Chart */}
            <div className="rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800">
                <div className="flex items-center gap-2 mb-4">
                    <IconChartPie className="text-blue-500" size={20} />
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                        Compatibilidad de Recursos Global
                    </h3>
                </div>

                <div className="flex flex-col md:flex-row items-center gap-8">
                    {/* SVG Pie Chart */}
                    <div className="flex-shrink-0">
                        <svg width="200" height="200" viewBox="0 0 200 200" className="drop-shadow">
                            <circle cx="100" cy="100" r="90" fill="none" stroke="#e5e7eb" strokeWidth="1" />
                            <PieSlice
                                cx={100}
                                cy={100}
                                r={90}
                                startAngle={0}
                                endAngle={compliantAngle}
                                fill="#10b981"
                            />
                            <PieSlice
                                cx={100}
                                cy={100}
                                r={90}
                                startAngle={compliantAngle}
                                endAngle={360}
                                fill="#ef4444"
                            />
                            <circle cx="100" cy="100" r="60" fill="white" className="dark:fill-gray-800" />
                            <text x="100" y="95" textAnchor="middle" className="text-xl font-bold" fill="currentColor">
                                {complianceRate.toFixed(1)}%
                            </text>
                            <text x="100" y="115" textAnchor="middle" className="text-sm" fill="currentColor">
                                Cumplimiento
                            </text>
                        </svg>
                    </div>

                    {/* Legend & Stats */}
                    <div className="flex-1 space-y-4">
                        <div className="flex items-center gap-3">
                            <div className="w-4 h-4 bg-green-500 rounded" />
                            <div>
                                <p className="text-sm text-gray-600 dark:text-gray-400">Conformes</p>
                                <p className="text-2xl font-bold text-gray-900 dark:text-white">{compliant.toLocaleString()}</p>
                            </div>
                        </div>
                        <div className="flex items-center gap-3">
                            <div className="w-4 h-4 bg-red-500 rounded" />
                            <div>
                                <p className="text-sm text-gray-600 dark:text-gray-400">No conformes</p>
                                <p className="text-2xl font-bold text-gray-900 dark:text-white">{nonCompliant.toLocaleString()}</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Resource Categories */}
            <div className="rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                    Compatibilidad por Categoría de Recursos
                </h3>
                <div className="space-y-3">
                    {resourceCategories.map((cat) => {
                        const total = Number(cat?.total ?? 0);
                        const compliantByCategory = Number(cat?.compliant ?? 0);
                        const rate = Number(cat?.rate ?? 0);
                        return (
                        <div key={cat.category} className="space-y-1">
                            <div className="flex justify-between items-center">
                                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{cat.category || 'Unknown'}</span>
                                <span className="text-sm font-semibold text-gray-900 dark:text-white">{rate.toFixed(1)}%</span>
                            </div>
                            <div className="w-full bg-gray-200 rounded-full h-2 dark:bg-gray-700">
                                <div
                                    className="bg-green-500 h-2 rounded-full transition-all"
                                    style={{ width: `${Math.max(0, Math.min(rate, 100))}%` }}
                                />
                            </div>
                            <p className="text-xs text-gray-500 dark:text-gray-400">
                                {compliantByCategory} de {total} recursos
                            </p>
                        </div>
                        );
                    })}
                </div>
            </div>

            {/* Initiatives */}
            <div className="rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                    Estado de Iniciativas
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {initiatives.map((initiative) => {
                        const affectedResources = Number(initiative?.affectedResources ?? 0);
                        const policies = Number(initiative?.policies ?? 0);
                        const compliance = Number(initiative?.compliance ?? 0);
                        return (
                        <div
                            key={initiative.id}
                            className="rounded-lg border dark:border-gray-700 p-4"
                            style={{
                                borderColor: initiative.status === 'compliant' ? '#d1fae5' : '#fee2e2',
                                backgroundColor: initiative.status === 'compliant' ? '#f0fdf4' : '#fef2f2',
                            }}
                        >
                            <div className="flex items-start gap-3">
                                <div className="flex-shrink-0 mt-0.5">
                                    {initiative.status === 'compliant' ? (
                                        <IconCheck className="text-green-600" size={20} />
                                    ) : (
                                        <IconAlertCircle className="text-red-600" size={20} />
                                    )}
                                </div>
                                <div className="flex-1">
                                    <h4 className="font-medium text-gray-900 dark:text-white">
                                        {initiative.name || 'Initiative'}
                                    </h4>
                                    <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                                        {policies} políticas · {affectedResources.toLocaleString()} recursos
                                    </p>
                                    <div className="mt-2 flex items-center gap-2">
                                        <div className="flex-1 bg-gray-200 rounded-full h-1.5 dark:bg-gray-700">
                                            <div
                                                className={`h-1.5 rounded-full transition-all ${
                                                    initiative.status === 'compliant' ? 'bg-green-500' : 'bg-red-500'
                                                }`}
                                                style={{ width: `${Math.max(0, Math.min(compliance, 100))}%` }}
                                            />
                                        </div>
                                        <span className="text-xs font-bold text-gray-900 dark:text-white ml-1">
                                            {compliance.toFixed(1)}%
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}

// Helper: Convert angle to SVG path
function PieSlice({
    cx,
    cy,
    r,
    startAngle,
    endAngle,
    fill,
}: {
    cx: number;
    cy: number;
    r: number;
    startAngle: number;
    endAngle: number;
    fill: string;
}) {
    const startRad = (startAngle * Math.PI) / 180;
    const endRad = (endAngle * Math.PI) / 180;

    const x1 = cx + r * Math.cos(startRad);
    const y1 = cy + r * Math.sin(startRad);
    const x2 = cx + r * Math.cos(endRad);
    const y2 = cy + r * Math.sin(endRad);

    const largeArc = endAngle - startAngle > 180 ? 1 : 0;

    const path = `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z`;

    return <path d={path} fill={fill} />;
}
