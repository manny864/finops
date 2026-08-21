"use client";
import MockBanner from '@/components/MockBanner';
import React, { useEffect, useState, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { useLocale } from 'next-intl';
import { useTenant } from '@/components/TenantProvider';
import { useMsal } from '@azure/msal-react';
import CostPieChart from '@/components/CostPieChart';
import PdfExportButton from '@/components/PdfExportButton';
import { FileText, AlertCircle, Sparkles, RefreshCw, TrendingUp, TrendingDown, ShieldAlert, DollarSign, Cpu, Leaf } from 'lucide-react';
import { isMockTenant } from '@/lib/mockData';
import { getFreshIdToken } from '@/lib/msalToken';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Decimal from 'decimal.js';
import { useSearchParams } from 'next/navigation';
import { errorMessage } from '@/lib/apiErrors';

const RESOURCE_CONFIG: Record<string, { type: string; savings: number; issueType: string }> = {
    unattachedDisks: { type: "Disk", savings: 15.0, issueType: "cost" },
    unusedIps: { type: "Public IP", savings: 3.5, issueType: "cost" },
    staleSnapshots: { type: "Snapshot", savings: 5.0, issueType: "cost" },
    emptyAppServicePlans: { type: "App Service Plan", savings: 45.0, issueType: "cost" },
    elasticPools: { type: "SQL Elastic Pool", savings: 250.0, issueType: "cost" },
    loadBalancers: { type: "Load Balancer", savings: 18.0, issueType: "cost" },
    frontDoorWaf: { type: "Front Door WAF", savings: 5.0, issueType: "cost" },
    trafficManager: { type: "Traffic Manager", savings: 3.0, issueType: "cost" },
    appGateways: { type: "App Gateway", savings: 180.0, issueType: "cost" },
    natGateways: { type: "NAT Gateway", savings: 32.0, issueType: "cost" },
    privateEndpoints: { type: "Private Endpoint", savings: 7.0, issueType: "cost" },
    vnetGateways: { type: "VNet Gateway", savings: 130.0, issueType: "cost" },
    ddos: { type: "DDoS Plan", savings: 2944.0, issueType: "cost" }
};

const SUGGESTIONS: Record<string, string> = {
    "Disco sin asociar": "Eliminar discos huérfanos que ya no están atachados a ninguna VM para detener el costo de almacenamiento.",
    "IP Pública sin asignar": "Desasignar y borrar direcciones IP públicas sin asociar.",
    "Snapshot Antiguo (>90d)": "Archivar o eliminar snapshots con más de 90 días de antigüedad.",
    "Plan ASP vacío": "Consolidar o eliminar App Service Plans sin Web Apps activas.",
    "Pool Vacío": "Destruir SQL Elastic Pools sin bases de datos.",
    "Sin Backend": "Eliminar Load Balancers sin pools de backend configurados.",
    "Sin Política": "Eliminar WAFs sin políticas aplicadas.",
    "Sin Backend IPs": "Apagar Application Gateways sin IPs de backend.",
    "Sin Subred": "Borrar NAT Gateways sin subredes asociadas.",
    "Sin Recursos": "Desactivar planes DDoS sin VNETs públicas vinculadas.",
    "Sin Conexiones": "Eliminar VNet Gateways sin conexiones activas (alto costo por hora).",
};
const EXECUTIVE_HISTORY_MONTHS = 6;
type SubscriptionOption = { id: string; name: string; state?: string };
type ReportJobStatus = 'idle' | 'queued' | 'processing' | 'completed' | 'failed';

function fmtUSD(n: number) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);
}

export default function ReportGeneratorPage() {
    const t = useTranslations('AdminReport');
    const locale = useLocale();
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();
    const searchParams = useSearchParams();

    const [audit, setAudit] = useState<any>(null);
    const [summary, setSummary] = useState<any>(null);
    const [ha, setHa] = useState<any>(null);
    const [forecast, setForecast] = useState<any>(null);
    const [tagCompliance, setTagCompliance] = useState<any>(null);
    const [commitments, setCommitments] = useState<any>(null);
    const [anomalies, setAnomalies] = useState<any>(null);
    const [rightsizing, setRightsizing] = useState<any>(null);
    const [budgets, setBudgets] = useState<any>(null);
    const [hybridBenefit, setHybridBenefit] = useState<any>(null);
    const [chargeback, setChargeback] = useState<any>(null);
    const [summaryHistory, setSummaryHistory] = useState<any>(null);
    const [subscriptions, setSubscriptions] = useState<SubscriptionOption[]>([]);
    const [loadingSubscriptions, setLoadingSubscriptions] = useState(false);
    const [selectedSubscriptionId, setSelectedSubscriptionId] = useState<string>('All');
    const [loadingData, setLoadingData] = useState(false);

    const [aiReport, setAiReport] = useState<string>("");
    const [aiLoading, setAiLoading] = useState(false);
    const [aiError, setAiError] = useState<string | null>(null);
    const [reportJobId, setReportJobId] = useState<number | null>(null);
    const [reportJobStatus, setReportJobStatus] = useState<ReportJobStatus>('idle');
    const [sendEmailToRequester, setSendEmailToRequester] = useState(false);

    const selectedSubscriptionName = useMemo(() => {
        if (selectedSubscriptionId === 'All') return t('allSubscriptionsOption');
        return subscriptions.find((s) => s.id === selectedSubscriptionId)?.name || selectedSubscriptionId;
    }, [selectedSubscriptionId, subscriptions, t]);

    useEffect(() => {
        if ((accounts.length === 0 && !isMockTenant(selectedTenant?.id || '')) || selectedTenant.id === 'default') return;
        let cancelled = false;

        const run = async () => {
            if (isMockTenant(selectedTenant.id)) {
                if (!cancelled) {
                    setSubscriptions([]);
                    setSelectedSubscriptionId('All');
                }
                return;
            }
            setLoadingSubscriptions(true);
            try {
                const idToken = accounts[0] ? await getFreshIdToken(instance, accounts[0]) : '';
                const res = await fetch(`/api/subscriptions?tenantId=${encodeURIComponent(selectedTenant.id)}`, {
                    headers: { Authorization: `Bearer ${idToken}` }
                });
                if (!res.ok) throw new Error(`subscriptions ${res.status}`);
                const json = await res.json();
                const list = Array.isArray(json?.subscriptions) ? json.subscriptions : [];
                if (!cancelled) {
                    setSubscriptions(list);
                    setSelectedSubscriptionId((prev) => (prev === 'All' || list.some((s: SubscriptionOption) => s.id === prev)) ? prev : 'All');
                }
            } catch {
                if (!cancelled) {
                    setSubscriptions([]);
                    setSelectedSubscriptionId('All');
                }
            } finally {
                if (!cancelled) setLoadingSubscriptions(false);
            }
        };
        run();

        return () => {
            cancelled = true;
        };
    }, [selectedTenant, accounts, instance]);

    useEffect(() => {
        setAiReport("");
        setAiError(null);
        setReportJobId(null);
        setReportJobStatus('idle');
    }, [selectedTenant.id, selectedSubscriptionId]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        const stored = window.localStorage.getItem('exec_report_email_opt_in');
        if (stored === '1') setSendEmailToRequester(true);
    }, []);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        window.localStorage.setItem('exec_report_email_opt_in', sendEmailToRequester ? '1' : '0');
    }, [sendEmailToRequester]);

    // ===== Fetch de datos paralelo =====
    useEffect(() => {
        if ((accounts.length === 0 && !isMockTenant(selectedTenant?.id || '')) || selectedTenant.id === 'default') return;

        const run = async () => {
            setLoadingData(true);
            try {
                const idToken = accounts[0] ? await getFreshIdToken(instance, accounts[0]) : '';
                const headers: any = { 'Authorization': `Bearer ${idToken}` };
                const billingHeaders: any = { ...headers, 'x-tenant-id': selectedTenant.id, 'x-subscription-id': selectedSubscriptionId };
                const rightsizingHeaders: any = { ...headers, 'x-tenant-id': selectedTenant.id, 'x-subscription-id': selectedSubscriptionId };
                const tid = selectedTenant.id;
                const scopeSub = encodeURIComponent(selectedSubscriptionId);
                const safe = (p: Promise<Response | null>) => p.then(r => r && r.ok ? r.json() : null).catch(() => null);

                const [
                    auditJ, summaryJ, haJ, forecastJ,
                    tagsJ, commitJ, anomJ, rsJ, budgetJ, ahubJ, chargeJ, summaryHistJ
                ] = await Promise.all([
                    safe(fetch(`/api/audit/full?tenantId=${tid}&subscriptionId=${scopeSub}`, { headers })),
                    safe(fetch(`/api/dashboard/summary?tenantId=${tid}&subscriptionId=${scopeSub}`, { headers })),
                    safe(fetch(`/api/governance/ha?tenantId=${tid}`, { headers })),
                    safe(fetch(`/api/intelligence/forecast?tenantId=${tid}&subscriptionId=${scopeSub}`, { headers })),
                    safe(fetch(`/api/tags/compliance?tenantId=${tid}&subscriptionId=${scopeSub}`, { headers })),
                    safe(fetch(`/api/intelligence/commitments?tenantId=${tid}`, { headers })),
                    safe(fetch(`/api/intelligence/anomalies?tenantId=${tid}&subscriptionId=${scopeSub}`, { headers })),
                    safe(fetch(`/api/intelligence/rightsizing`, { headers: rightsizingHeaders })),
                    safe(fetch(`/api/budgets?tenantId=${tid}&subscriptionId=${scopeSub}`, { headers })),
                    safe(fetch(`/api/intelligence/hybrid-benefit?tenantId=${tid}`, { headers })),
                    safe(fetch(`/api/intelligence/chargeback?tenantId=${tid}&subscriptionId=${scopeSub}`, { headers })),
                    safe(fetch(`/api/dashboard/summary?tenantId=${tid}&subscriptionId=${scopeSub}&months=${EXECUTIVE_HISTORY_MONTHS}`, { headers: billingHeaders })),
                ]);
                setAudit(auditJ); setSummary(summaryJ); setHa(haJ); setForecast(forecastJ);
                setTagCompliance(tagsJ); setCommitments(commitJ); setAnomalies(anomJ);
                setRightsizing(rsJ); setBudgets(budgetJ); setHybridBenefit(ahubJ);
                setChargeback(chargeJ); setSummaryHistory(summaryHistJ);
            } catch (e) {
                console.warn('[Report] fetch error', e);
            } finally {
                setLoadingData(false);
            }
        };
        run();
    }, [selectedTenant, accounts, instance, selectedSubscriptionId]);

    // ===== Mappers / derived data =====
    const mappedFindings = useMemo(() => {
        if (!audit?.auditResults) return [];
        const out: any[] = [];
        for (const [key, cfg] of Object.entries(RESOURCE_CONFIG)) {
            const items = audit.auditResults[key] || [];
            out.push(...items.map((r: any) => ({
                ...r,
                type: cfg.type,
                issueType: cfg.issueType,
                potentialSavings: r.estimatedMonthlyCost || (r.diskSizeGB ? r.diskSizeGB * 0.15 : (r.sizeGB ? r.sizeGB * 0.05 : cfg.savings))
            })));
        }
        return out;
    }, [audit]);

    const totalSavings = mappedFindings.reduce((s, i) => s + (i.potentialSavings || 0), 0);
    const annualSavings = totalSavings * 12;
    const findingsCount = mappedFindings.length;

    const groupedIssues = useMemo(() => {
        const acc: Record<string, any> = {};
        mappedFindings.forEach((curr: any) => {
            const k = curr.issue || t('unclassifiedIssue');
            if (!acc[k]) acc[k] = { count: 0, potentialSavings: 0, type: curr.type, issueType: curr.issueType };
            acc[k].count += 1;
            acc[k].potentialSavings += curr.potentialSavings;
        });
        return Object.entries(acc).sort((a: any, b: any) => b[1].potentialSavings - a[1].potentialSavings);
    }, [mappedFindings, t]);

    const haItems = ha?.items || [];
    const haCounts = ha?.counts || { critical: 0, high: 0, medium: 0, low: 0 };
    const haCritical = (haCounts.critical || 0) + (haCounts.high || 0);

    const actualCost = Number(summary?.actualCost || 0);
    const projectedCost = Number(summary?.projectedCost || 0);
    const projectionDelta = projectedCost - actualCost;
    const envImpact = Number(summary?.environmentalImpact || 0);

    // ===== Derived metrics (Secciones 2-4) =====
    const tagging = useMemo(() => {
        const tc: any = tagCompliance || {};
        const pct = Number(tc.compliancePercentage ?? tc.percentage ?? tc.coveragePct ?? 0);
        const tagged = Number(tc.taggedCount ?? tc.tagged ?? 0);
        const untagged = Number(tc.untaggedCount ?? tc.untagged ?? 0);
        return { pct, tagged, untagged, total: tagged + untagged };
    }, [tagCompliance]);

    const commitmentsKpi = useMemo(() => {
        const c: any = commitments || {};
        const coverage = Number(c.coveragePercentage ?? c.coverage ?? c.utilizationPct ?? 0);
        const annualSav = Number(c.annualSavings ?? c.estimatedSavings ?? 0);
        const recos = Array.isArray(c.recommendations) ? c.recommendations.length : Number(c.recommendationsCount || 0);
        return { coverage, annualSav, recos };
    }, [commitments]);

    const anomaliesKpi = useMemo(() => {
        const a: any = anomalies || {};
        const list = Array.isArray(a.anomalies) ? a.anomalies : (Array.isArray(a.items) ? a.items : (Array.isArray(a.data) ? a.data : []));
        const totalImpact = list.reduce((s: number, x: any) => s + Number(x.impact || x.deltaCost || 0), 0);
        return { count: list.length, totalImpact, items: list.slice(0, 5) };
    }, [anomalies]);

    const rightsizingKpi = useMemo(() => {
        const r: any = rightsizing || {};
        const list = Array.isArray(r.recommendations) ? r.recommendations : (Array.isArray(r.items) ? r.items : (Array.isArray(r.data) ? r.data : []));
        const monthlySav = list.reduce((s: number, x: any) => s + Number(x.monthlySavings || x.estimatedSavings || x.savings || 0), 0);
        return { count: list.length, monthlySav, items: list.slice(0, 5) };
    }, [rightsizing]);

    const budgetsKpi = useMemo(() => {
        const b: any = budgets || {};
        const list = Array.isArray(b.budgets) ? b.budgets : (Array.isArray(b.items) ? b.items : (Array.isArray(b) ? b : []));
        const totalBudget = list.reduce((s: number, x: any) => s + Number(x.amount || x.budget || 0), 0);
        const totalConsumed = list.reduce((s: number, x: any) => s + Number(x.currentSpend || x.actualSpend || x.consumed || 0), 0);
        const burnPct = totalBudget > 0 ? (totalConsumed / totalBudget) * 100 : 0;
        const exceeding = list.filter((x: any) => Number(x.currentSpend || x.actualSpend || 0) > Number(x.amount || x.budget || 0));
        return { count: list.length, totalBudget, totalConsumed, burnPct, exceeding: exceeding.length };
    }, [budgets]);

    const ahubKpi = useMemo(() => {
        const h: any = hybridBenefit || {};
        const savings = Number(h.estimatedAnnualSavings ?? h.annualSavings ?? h.savings ?? 0);
        const eligible = Number(h.eligibleVms ?? h.eligibleCount ?? 0);
        const enabled = Number(h.enabledVms ?? h.enabledCount ?? 0);
        return { savings, eligible, enabled };
    }, [hybridBenefit]);

    const chargebackKpi = useMemo(() => {
        const c: any = chargeback || {};
        const centers = Array.isArray(c.costCenters) ? c.costCenters : (Array.isArray(c.departments) ? c.departments : (Array.isArray(c.items) ? c.items : []));
        const top = [...centers].sort((a: any, b: any) => Number(b.cost || b.total || 0) - Number(a.cost || a.total || 0)).slice(0, 5);
        return { totalCenters: centers.length, top };
    }, [chargeback]);

    const historicalFinanceKpi = useMemo(() => {
        const histogram = Array.isArray(summaryHistory?.histogram) ? summaryHistory.histogram : [];
        const monthTotals = new Map<string, Decimal>();

        histogram.forEach((item: any) => {
            const dateRaw = String(item?.date || '');
            if (!/^\d{4}-\d{2}-\d{2}$/.test(dateRaw)) return;
            const monthKey = dateRaw.slice(0, 7);
            const prev = monthTotals.get(monthKey) || new Decimal(0);
            monthTotals.set(monthKey, prev.plus(new Decimal(item?.cost || 0)));
        });

        const monthDate = new Date();
        const previousMonths = Array.from({ length: EXECUTIVE_HISTORY_MONTHS }, (_, idx) => {
            const base = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
            base.setMonth(base.getMonth() - EXECUTIVE_HISTORY_MONTHS + idx);
            const monthKey = `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, '0')}`;
            return {
                monthKey,
                monthLabel: base.toLocaleDateString(undefined, { month: 'short', year: 'numeric' }),
                cost: monthTotals.get(monthKey) || new Decimal(0),
            };
        });
        const previousMonthsWithDelta = previousMonths.map((row, idx) => {
            if (idx === 0) return { ...row, deltaPctFromPrevious: null as number | null };
            const prevCost = previousMonths[idx - 1].cost;
            if (prevCost.lte(0)) return { ...row, deltaPctFromPrevious: null as number | null };
            const delta = row.cost.minus(prevCost).dividedBy(prevCost).times(100);
            return { ...row, deltaPctFromPrevious: delta.toDecimalPlaces(1, Decimal.ROUND_HALF_UP).toNumber() };
        });

        const previousTotal = previousMonths.reduce((acc, row) => acc.plus(row.cost), new Decimal(0));
        const previousAverage = previousTotal.dividedBy(EXECUTIVE_HISTORY_MONTHS);
        const lastMonthCost = previousMonths[EXECUTIVE_HISTORY_MONTHS - 1]?.cost || new Decimal(0);
        const projected = new Decimal(projectedCost || 0);

        const projectionVsLastMonthPct = lastMonthCost.greaterThan(0)
            ? projected.minus(lastMonthCost).dividedBy(lastMonthCost).times(100)
            : new Decimal(0);
        const projectionVsSixMonthAvgPct = previousAverage.greaterThan(0)
            ? projected.minus(previousAverage).dividedBy(previousAverage).times(100)
            : new Decimal(0);

        const firstHalfAvg = previousMonths
            .slice(0, 3)
            .reduce((acc, row) => acc.plus(row.cost), new Decimal(0))
            .dividedBy(3);
        const secondHalfAvg = previousMonths
            .slice(3)
            .reduce((acc, row) => acc.plus(row.cost), new Decimal(0))
            .dividedBy(3);
        const trend = secondHalfAvg.greaterThan(firstHalfAvg)
            ? 'up'
            : secondHalfAvg.lessThan(firstHalfAvg)
                ? 'down'
                : 'stable';

        const finopsScore =
            (tagging.pct >= 90 ? 2 : tagging.pct >= 80 ? 1 : 0) +
            (commitmentsKpi.coverage >= 80 ? 2 : commitmentsKpi.coverage >= 70 ? 1 : 0) +
            (budgetsKpi.count > 0 ? 1 : 0) +
            (budgetsKpi.exceeding === 0 && budgetsKpi.count > 0 ? 1 : 0) +
            (anomaliesKpi.count <= 1 ? 1 : 0) +
            (haCritical === 0 ? 1 : 0) +
            (rightsizingKpi.monthlySav > 0 ? 1 : 0);

        const finopsStatus = finopsScore >= 7 ? 'healthy' : finopsScore >= 4 ? 'attention' : 'urgent';

        return {
            months: previousMonthsWithDelta,
            sixMonthAccumulated: previousTotal.toNumber(),
            previousAverage: previousAverage.toNumber(),
            lastMonthCost: lastMonthCost.toNumber(),
            projectedByAccumulatedRate: projected.toNumber(),
            projectedByLastMonth: lastMonthCost.toNumber(),
            projectionVsLastMonthPct: projectionVsLastMonthPct.toDecimalPlaces(1, Decimal.ROUND_HALF_UP).toNumber(),
            projectionVsSixMonthAvgPct: projectionVsSixMonthAvgPct.toDecimalPlaces(1, Decimal.ROUND_HALF_UP).toNumber(),
            trend,
            finopsScore,
            finopsStatus,
        };
    }, [summaryHistory, projectedCost, tagging.pct, commitmentsKpi.coverage, budgetsKpi.count, budgetsKpi.exceeding, anomaliesKpi.count, haCritical, rightsizingKpi.monthlySav]);

    // ===== AI narrative generation =====
    const fetchReportJob = async (jobId: number) => {
        const idToken = accounts[0] ? await getFreshIdToken(instance, accounts[0]) : '';
        const res = await fetch(
            `/api/intelligence/executive-report/jobs?tenantId=${encodeURIComponent(selectedTenant.id)}&jobId=${jobId}`,
            { headers: { Authorization: `Bearer ${idToken}` } }
        );
        if (!res.ok) {
            const body = await res.text();
            throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
        }
        const data = await res.json();
        return data?.job || null;
    };

    const generateAiReport = async () => {
        setAiError(null);
        setAiLoading(true);
        setAiReport("");
        setReportJobStatus('queued');

        const compactPayload = {
            tenant: selectedTenant.name,
            scope: selectedSubscriptionId === 'All'
                ? t('allSubscriptionsOption')
                : `${selectedSubscriptionName} (${selectedSubscriptionId})`,
            // §1 Resumen alto nivel
            costs: {
                mtd: actualCost,
                projected: projectedCost,
                deltaVsProjected: projectionDelta,
                previousMonth: historicalFinanceKpi.lastMonthCost,
                monthOverMonthPct: historicalFinanceKpi.projectionVsLastMonthPct,
                environmentalKgCO2: envImpact
            },
            historicalBaseline: {
                previousMonthsCount: EXECUTIVE_HISTORY_MONTHS,
                trend: historicalFinanceKpi.trend,
                sixMonthAccumulated: historicalFinanceKpi.sixMonthAccumulated,
                sixMonthAverage: historicalFinanceKpi.previousAverage,
                projectionVsSixMonthAvgPct: historicalFinanceKpi.projectionVsSixMonthAvgPct,
                projectionVsLastMonthPct: historicalFinanceKpi.projectionVsLastMonthPct,
                projectedByAccumulatedRate: historicalFinanceKpi.projectedByAccumulatedRate,
                projectedByLastMonth: historicalFinanceKpi.projectedByLastMonth,
                months: historicalFinanceKpi.months.map((m) => ({
                    month: m.monthKey,
                    cost: m.cost.toNumber(),
                    deltaPctFromPrevious: m.deltaPctFromPrevious
                })),
            },
            finopsStatus: {
                score: historicalFinanceKpi.finopsScore,
                status: historicalFinanceKpi.finopsStatus,
                commitmentsCoveragePct: commitmentsKpi.coverage,
                taggingCoveragePct: tagging.pct,
                budgetBurnPct: budgetsKpi.burnPct,
                openAnomalies: anomaliesKpi.count,
                haCriticalHigh: haCritical,
            },
            // §2 Visibilidad y asignación
            tagging,
            chargeback: chargebackKpi,
            // §3 Optimización
            savings: { monthly: totalSavings, annual: annualSavings, totalFindings: findingsCount },
            commitments: commitmentsKpi,
            rightsizing: rightsizingKpi,
            hybridBenefit: ahubKpi,
            topIssues: groupedIssues.slice(0, 10).map(([name, d]: any) => ({
                issue: name, type: d.type, count: d.count, savings: d.potentialSavings
            })),
            // §4 Gobernanza y anomalías
            budgets: budgetsKpi,
            anomalies: anomaliesKpi,
            ha: { counts: haCounts, totalIssues: haItems.length, topRisks: haItems.slice(0, 8).map((i: any) => ({
                name: i.resourceName, type: i.resourceType, severity: i.severity, issue: i.issueType, risk: i.estimatedRisk
            })) },
            forecastSeries: Array.isArray(forecast?.data) ? forecast.data.slice(-30) : []
        };

        try {
            const idToken = accounts[0] ? await getFreshIdToken(instance, accounts[0]) : '';
            const res = await fetch('/api/intelligence/executive-report/jobs', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
                body: JSON.stringify({
                    metricsData: compactPayload,
                    tenantId: selectedTenant.id,
                    locale,
                    subscriptionId: selectedSubscriptionId,
                    subscriptionName: selectedSubscriptionName,
                    sendEmailToRequester
                })
            });
            if (!res.ok) {
                const t = await res.text();
                throw new Error(`HTTP ${res.status}: ${t.slice(0, 200)}`);
            }
            const data = await res.json();
            const createdJobId = Number(data?.jobId || 0);
            if (!createdJobId) throw new Error(t('aiGenerationError'));
            setReportJobId(createdJobId);
            setReportJobStatus('queued');
        } catch (e) {
            setAiError(errorMessage(e) || t('aiGenerationError'));
            setAiLoading(false);
            setReportJobStatus('failed');
        }
    };

    useEffect(() => {
        const fromUrl = Number(searchParams.get('reportJob')) || 0;
        if (!fromUrl || selectedTenant.id === 'default') return;

        let cancelled = false;
        (async () => {
            try {
                const job = await fetchReportJob(fromUrl);
                if (cancelled || !job) return;
                setReportJobId(job.id);
                setReportJobStatus(job.status || 'idle');
                if (job.status === 'completed') {
                    setAiReport(String(job.report || ''));
                    setAiLoading(false);
                } else if (job.status === 'failed') {
                    setAiError(job.error || t('aiGenerationError'));
                    setAiLoading(false);
                } else {
                    setAiLoading(true);
                }
            } catch (e) {
                if (!cancelled) {
                    setAiError(errorMessage(e) || t('aiGenerationError'));
                    setAiLoading(false);
                }
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [searchParams, selectedTenant.id]);

    useEffect(() => {
        if (!reportJobId || (reportJobStatus !== 'queued' && reportJobStatus !== 'processing')) return;
        let cancelled = false;

        const tick = async () => {
            try {
                const job = await fetchReportJob(reportJobId);
                if (cancelled || !job) return;
                const status = (job.status || 'idle') as ReportJobStatus;
                setReportJobStatus(status);

                if (status === 'completed') {
                    setAiReport(String(job.report || ''));
                    setAiLoading(false);
                } else if (status === 'failed') {
                    setAiError(job.error || t('aiGenerationError'));
                    setAiLoading(false);
                } else {
                    setAiLoading(true);
                }
            } catch (e) {
                if (!cancelled) {
                    setAiError(errorMessage(e) || t('aiGenerationError'));
                    setAiLoading(false);
                }
            }
        };

        void tick();
        const intervalId = setInterval(tick, 5000);
        return () => {
            cancelled = true;
            clearInterval(intervalId);
        };
    }, [reportJobId, reportJobStatus, selectedTenant.id, selectedSubscriptionId, accounts, instance]);

    const jobStatusLabel = useMemo(() => {
        if (reportJobStatus === 'queued') return t('jobQueued');
        if (reportJobStatus === 'processing') return t('jobProcessing');
        if (reportJobStatus === 'completed') return t('jobCompleted');
        if (reportJobStatus === 'failed') return t('jobFailed');
        return '';
    }, [reportJobStatus, t]);

    // Directiva: el reporte ejecutivo se genera solo por acción explícita del usuario.

    if (selectedTenant.id === 'default') {
        return (
            <div className="flex flex-col items-center justify-center h-96 bg-white rounded-lg border border-gray-200 shadow-sm">
                <span className="text-4xl mb-4">🔐</span>
                <h2 className="text-xl font-bold text-gray-700">{t('selectTenantTitle')}</h2>
                <p className="text-sm text-gray-500 mt-2">{t('selectTenantSubtitle')}</p>
            </div>
        );
    }

    return (
        <div className="max-w-6xl mx-auto animate-in fade-in duration-500">
            <MockBanner />
            <div className="mb-6 flex flex-col md:flex-row justify-between items-start md:items-end border-b border-gray-200 dark:border-gray-800 pb-4 gap-4">
                <div>
                    <h1 className="text-3xl font-extrabold text-gray-900 dark:text-white tracking-tight flex items-center">
                        <FileText className="w-8 h-8 mr-3 text-indigo-600 dark:text-indigo-400" />
                        {t('pageTitle')}
                    </h1>
                    <p className="text-gray-500 dark:text-gray-400 mt-2">
                        {t('pageSubtitle')}
                    </p>
                    <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2.5 py-1.5 inline-block mt-2">
                        {t('aiDisclaimer')}
                    </p>
                </div>
                <div className="flex flex-col items-stretch sm:items-end gap-2 w-full md:w-auto">
                    <div className="flex items-center gap-2">
                        <label htmlFor="report-scope" className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                            {t('scopeLabel')}
                        </label>
                        <select
                            id="report-scope"
                            value={selectedSubscriptionId}
                            onChange={(e) => setSelectedSubscriptionId(e.target.value)}
                            className="h-9 rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-700"
                            disabled={loadingData || loadingSubscriptions}
                        >
                            <option value="All">{t('allSubscriptionsOption')}</option>
                            {subscriptions.map((sub) => (
                                <option key={sub.id} value={sub.id}>
                                    {sub.name}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={generateAiReport}
                            disabled={aiLoading || loadingData || loadingSubscriptions}
                            className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-semibold disabled:opacity-50"
                        >
                            {aiLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                            {aiLoading ? t('generatingButton') : t('regenerateButton')}
                        </button>
                        <PdfExportButton targetId="pdf-export-area" tenantName={selectedTenant.name} />
                    </div>
                    <label className="inline-flex items-center gap-2 text-xs text-gray-600 w-full sm:w-auto">
                        <input
                            type="checkbox"
                            className="h-3.5 w-3.5 rounded border-gray-300"
                            checked={sendEmailToRequester}
                            onChange={(e) => setSendEmailToRequester(e.target.checked)}
                        />
                        <span>{t('emailOptionLabel')}</span>
                    </label>
                </div>
            </div>

            {jobStatusLabel && (
                <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
                    <span className="px-2.5 py-1 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200">
                        {jobStatusLabel}
                    </span>
                </div>
            )}

            <div className="bg-gray-100 dark:bg-slate-800 p-8 rounded-xl border border-gray-200 dark:border-slate-700">
                <div className="mb-4 flex items-center text-sm font-bold text-gray-500 uppercase tracking-wider">
                    <AlertCircle className="w-4 h-4 mr-2" /> {t('documentPreview')}
                </div>

                <div id="pdf-export-area" className="bg-white p-8 rounded-lg shadow-lg border border-gray-200 text-gray-900" style={{ width: '100%', minHeight: '800px' }}>
                    {/* HEADER */}
                    <div className="text-center mb-8 border-b border-gray-200 pb-6">
                        <h2 className="text-3xl font-extrabold text-[#0054A6]">{t('reportTitle')}</h2>
                        <p className="text-gray-500 mt-2 text-lg">{t('organizationLabel', { name: selectedTenant.name })}</p>
                        <p className="text-gray-400 mt-1 text-sm">{t('scopeValueLabel', { scope: selectedSubscriptionName })}</p>
                        <p className="text-gray-400 mt-1 text-sm">{t('generatedLabel', { date: new Date().toLocaleString('es-AR') })}</p>
                    </div>

                    {/* KPI STRIP (10 indicadores en 2 filas) */}
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
                        <KPI icon={<DollarSign className="w-4 h-4" />} label={t('kpiMtdSpend')} value={fmtUSD(actualCost)} sub={t('kpiVsLastMonth', { value: `${historicalFinanceKpi.projectionVsLastMonthPct > 0 ? '+' : ''}${historicalFinanceKpi.projectionVsLastMonthPct.toFixed(1)}` })} color="text-blue-700 bg-blue-50 border-blue-200" />
                        <KPI icon={<TrendingUp className="w-4 h-4" />} label={t('kpiMonthProjection')} value={fmtUSD(projectedCost)} color="text-indigo-700 bg-indigo-50 border-indigo-200" />
                        <KPI icon={<TrendingDown className="w-4 h-4" />} label={t('kpiMonthlySavings')} value={fmtUSD(totalSavings)} sub={t('kpiAnnualized', { value: fmtUSD(annualSavings) })} color="text-emerald-700 bg-emerald-50 border-emerald-200" />
                        <KPI icon={<ShieldAlert className="w-4 h-4" />} label={t('kpiHaCriticalHigh')} value={String(haCritical)} sub={t('kpiTotalCount', { count: haItems.length })} color="text-rose-700 bg-rose-50 border-rose-200" />
                        <KPI icon={<Leaf className="w-4 h-4" />} label={t('kpiCo2Impact')} value={`${envImpact} kg`} color="text-green-700 bg-green-50 border-green-200" />
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-10">
                        <KPI icon={<DollarSign className="w-4 h-4" />} label={t('kpiTaggingCoverage')} value={`${tagging.pct.toFixed(0)}%`} sub={tagging.total ? `${tagging.tagged}/${tagging.total}` : t('notAvailable')} color="text-cyan-700 bg-cyan-50 border-cyan-200" />
                        <KPI icon={<TrendingUp className="w-4 h-4" />} label={t('kpiCommitments')} value={`${commitmentsKpi.coverage.toFixed(0)}%`} sub={commitmentsKpi.annualSav ? t('kpiSavingsPerYear', { value: fmtUSD(commitmentsKpi.annualSav) }) : undefined} color="text-purple-700 bg-purple-50 border-purple-200" />
                        <KPI icon={<Cpu className="w-4 h-4" />} label={t('kpiRightSizing')} value={String(rightsizingKpi.count)} sub={rightsizingKpi.monthlySav ? t('kpiPerMonth', { value: fmtUSD(rightsizingKpi.monthlySav) }) : t('notAvailable')} color="text-orange-700 bg-orange-50 border-orange-200" />
                        <KPI icon={<AlertCircle className="w-4 h-4" />} label={t('kpiAnomalies')} value={String(anomaliesKpi.count)} sub={anomaliesKpi.totalImpact ? t('kpiImpactValue', { value: fmtUSD(anomaliesKpi.totalImpact) }) : t('kpiNoAlerts')} color="text-yellow-700 bg-yellow-50 border-yellow-200" />
                        <KPI icon={<DollarSign className="w-4 h-4" />} label={t('kpiBudgetBurn')} value={budgetsKpi.totalBudget > 0 ? `${budgetsKpi.burnPct.toFixed(0)}%` : t('notAvailable')} sub={budgetsKpi.exceeding ? t('kpiExceededCount', { count: budgetsKpi.exceeding }) : t('kpiConfiguredCount', { count: budgetsKpi.count })} color={budgetsKpi.burnPct > 90 ? "text-rose-700 bg-rose-50 border-rose-200" : "text-slate-700 bg-slate-50 border-slate-200"} />
                    </div>

                    <div className="mt-8 mb-10 pt-8 border-t border-gray-200">
                        <h3 className="text-2xl font-extrabold text-[#0054A6] mb-2">{t('historicalAnalysisTitle')}</h3>
                        <p className="text-sm text-gray-500 mb-4">
                            {t('historicalAnalysisSummary', {
                                months: EXECUTIVE_HISTORY_MONTHS,
                                avg: fmtUSD(historicalFinanceKpi.previousAverage),
                                deltaAvg: `${historicalFinanceKpi.projectionVsSixMonthAvgPct > 0 ? '+' : ''}${historicalFinanceKpi.projectionVsSixMonthAvgPct.toFixed(1)}%`,
                                deltaLast: `${historicalFinanceKpi.projectionVsLastMonthPct > 0 ? '+' : ''}${historicalFinanceKpi.projectionVsLastMonthPct.toFixed(1)}%`,
                            })}
                        </p>
                        <div className="overflow-x-auto mb-4">
                            <table className="min-w-full text-xs border-collapse border border-gray-200">
                                <thead className="bg-gray-100">
                                    <tr>
                                        <th className="border border-gray-200 px-3 py-2 text-left">{t('tableMonth')}</th>
                                        <th className="border border-gray-200 px-3 py-2 text-right">{t('tableMonthlyCost')}</th>
                                        <th className="border border-gray-200 px-3 py-2 text-right">{t('tableMonthComparison')}</th>
                                        <th className="border border-gray-200 px-3 py-2 text-left">{t('tableTrend')}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {historicalFinanceKpi.months.map((row) => (
                                        <tr key={row.monthKey} className="odd:bg-white even:bg-gray-50">
                                            <td className="border border-gray-200 px-3 py-2">{row.monthLabel}</td>
                                            <td className="border border-gray-200 px-3 py-2 text-right">{fmtUSD(row.cost.toNumber())}</td>
                                            <td className="border border-gray-200 px-3 py-2 text-right">
                                                {row.deltaPctFromPrevious === null
                                                    ? t('notAvailable')
                                                    : `${row.deltaPctFromPrevious > 0 ? '+' : ''}${row.deltaPctFromPrevious.toFixed(1)}%`}
                                            </td>
                                            <td className="border border-gray-200 px-3 py-2">
                                                {row.deltaPctFromPrevious === null
                                                    ? '—'
                                                    : row.deltaPctFromPrevious > 0
                                                        ? t('trendUp')
                                                        : row.deltaPctFromPrevious < 0
                                                            ? t('trendDown')
                                                            : t('trendStable')}
                                            </td>
                                        </tr>
                                    ))}
                                    <tr className="bg-indigo-50 font-semibold">
                                        <td className="border border-gray-200 px-3 py-2">{t('projectedMonthLabel')}</td>
                                        <td className="border border-gray-200 px-3 py-2 text-right">{fmtUSD(projectedCost)}</td>
                                        <td className="border border-gray-200 px-3 py-2 text-right">{`${historicalFinanceKpi.projectionVsLastMonthPct > 0 ? '+' : ''}${historicalFinanceKpi.projectionVsLastMonthPct.toFixed(1)}%`}</td>
                                        <td className="border border-gray-200 px-3 py-2">
                                            {historicalFinanceKpi.trend === 'up'
                                                ? t('trendUp')
                                                : historicalFinanceKpi.trend === 'down'
                                                    ? t('trendDown')
                                                    : t('trendStable')}
                                        </td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                        <div className="flex flex-wrap gap-3 text-xs">
                            <span className="px-3 py-1 rounded-full bg-slate-100 text-slate-700">{t('sixMonthAccumulated', { value: fmtUSD(historicalFinanceKpi.sixMonthAccumulated) })}</span>
                            <span className="px-3 py-1 rounded-full bg-slate-100 text-slate-700">{t('sixMonthAverage', { value: fmtUSD(historicalFinanceKpi.previousAverage) })}</span>
                            <span className="px-3 py-1 rounded-full bg-indigo-100 text-indigo-700">{t('projectionVs6mAvg', { value: `${historicalFinanceKpi.projectionVsSixMonthAvgPct > 0 ? '+' : ''}${historicalFinanceKpi.projectionVsSixMonthAvgPct.toFixed(1)}%` })}</span>
                            <span className="px-3 py-1 rounded-full bg-blue-100 text-blue-700">{t('projectionVsLastMonth', { value: `${historicalFinanceKpi.projectionVsLastMonthPct > 0 ? '+' : ''}${historicalFinanceKpi.projectionVsLastMonthPct.toFixed(1)}%` })}</span>
                            <span className="px-3 py-1 rounded-full bg-indigo-100 text-indigo-700">{t('projectionByAccumulatedRate', { value: fmtUSD(historicalFinanceKpi.projectedByAccumulatedRate) })}</span>
                            <span className="px-3 py-1 rounded-full bg-blue-100 text-blue-700">{t('projectionByLastMonth', { value: fmtUSD(historicalFinanceKpi.projectedByLastMonth) })}</span>
                            <span className={`px-3 py-1 rounded-full ${historicalFinanceKpi.finopsStatus === 'healthy' ? 'bg-emerald-100 text-emerald-700' : historicalFinanceKpi.finopsStatus === 'attention' ? 'bg-amber-100 text-amber-700' : 'bg-rose-100 text-rose-700'}`}>
                                {t(`finopsStatus_${historicalFinanceKpi.finopsStatus}`)}
                            </span>
                        </div>
                    </div>

                    {/* AI NARRATIVE */}
                    <div className="mb-10">
                        <h3 className="text-2xl font-extrabold text-[#0054A6] mb-4 flex items-center">
                            <Sparkles className="w-6 h-6 mr-2 text-indigo-600" />
                            {t('aiAnalysisTitle')}
                        </h3>
                        <div className="bg-gradient-to-br from-indigo-50 to-blue-50 border border-indigo-100 rounded-xl p-6 overflow-hidden">
                            {aiLoading && !aiReport && (
                                <div className="flex items-center gap-2 text-indigo-600 text-sm py-8 justify-center">
                                    <RefreshCw className="w-4 h-4 animate-spin" />
                                    {t('generatingAnalysis', { findings: findingsCount, ha: haItems.length })}
                                </div>
                            )}
                            {aiError && (
                                <div className="text-rose-700 text-sm bg-rose-50 border border-rose-200 rounded p-3">
                                    <strong>{t('aiErrorPrefix')}</strong> {aiError}
                                </div>
                            )}
                            {aiReport && (
                                <div className="prose prose-sm max-w-none text-gray-800 break-words" style={{ textAlign: 'justify', textJustify: 'inter-word', hyphens: 'auto', overflowWrap: 'anywhere', wordBreak: 'break-word' }}>
                                    <ReactMarkdown
                                        remarkPlugins={[remarkGfm]}
                                        components={{
                                            h3: ({node, ...p}) => <h3 className="text-lg font-bold text-[#0054A6] mt-5 mb-2 text-left" {...p} />,
                                            h4: ({node, ...p}) => <h4 className="text-base font-bold text-gray-800 mt-3 mb-1 text-left" {...p} />,
                                            p: ({node, ...p}) => <p className="mb-3 leading-relaxed text-justify" {...p} />,
                                            ul: ({node, ...p}) => <ul className="list-disc ml-6 mb-3 space-y-1 text-justify" {...p} />,
                                            ol: ({node, ...p}) => <ol className="list-decimal ml-6 mb-3 space-y-1 text-justify" {...p} />,
                                            li: ({node, ...p}) => <li className="leading-relaxed" {...p} />,
                                            strong: ({node, ...p}) => <strong className="font-bold text-gray-900" {...p} />,
                                            table: ({node, ...p}) => <div className="overflow-x-auto my-4 max-w-full"><table className="w-full text-xs border-collapse border border-gray-300 table-auto" {...p} /></div>,
                                            thead: ({node, ...p}) => <thead className="bg-indigo-100" {...p} />,
                                            th: ({node, ...p}) => <th className="border border-gray-300 px-3 py-2 text-left font-bold text-gray-800 align-top break-words" {...p} />,
                                            td: ({node, ...p}) => <td className="border border-gray-300 px-3 py-2 align-top break-words" {...p} />,
                                            code: ({node, ...p}) => <code className="bg-white/60 px-1 py-0.5 rounded text-[12px] font-mono break-all" {...p} />,
                                        }}
                                    >
                                        {aiReport}
                                    </ReactMarkdown>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* PIE CHART */}
                    <div className="max-w-2xl mx-auto mt-8 mb-10">
                        <h3 className="text-xl font-bold text-gray-800 mb-4 text-center border-b border-gray-100 pb-2">{t('inefficiencyDistribution')}</h3>
                        {loadingData ? (
                            <div className="h-64 flex items-center justify-center text-gray-400 animate-pulse">{t('calculatingCharts')}</div>
                        ) : mappedFindings.length > 0 ? (
                            <div className="h-80"><CostPieChart data={mappedFindings} onSegmentClick={() => {}} /></div>
                        ) : (
                            <div className="text-center text-gray-500 py-10">{t('optimizedEnvironment')}</div>
                        )}
                    </div>

                    {/* HALLAZGOS DETALLADOS */}
                    <div className="mt-12 pt-8 border-t border-gray-200" style={{ pageBreakBefore: groupedIssues.length > 0 ? "always" : "auto" }}>
                        <h3 className="text-2xl font-extrabold text-[#0054A6] mb-6">{t('findingsTitle')}</h3>
                        {groupedIssues.length === 0 ? (
                            <p className="text-gray-500 text-center py-4">{t('noFindings')}</p>
                        ) : (
                            <div className="space-y-4">
                                {groupedIssues.map(([issueName, data]: any, idx: number) => (
                                    <div key={idx} className="bg-gray-50 border border-gray-100 rounded-lg p-5">
                                        <div className="flex justify-between items-start mb-3 border-b border-gray-200 pb-3">
                                            <div>
                                                <h4 className="text-lg font-bold text-gray-900 flex items-center">
                                                    <span className={`w-3 h-3 rounded-full mr-2 ${data.issueType === 'cost' ? 'bg-red-500' : 'bg-amber-500'}`}></span>
                                                    {issueName}
                                                </h4>
                                                <p className="text-sm text-gray-500 mt-1">
                                                    <span className="font-semibold text-gray-700">{data.count}</span> {t('resourceCountLabel')} · {t('typeLabel')} {data.type}
                                                </p>
                                            </div>
                                            <div className="text-right">
                                                <span className={`text-lg font-extrabold ${data.potentialSavings > 0 ? 'text-green-600' : 'text-gray-400'}`}>
                                                    {data.potentialSavings > 0 ? fmtUSD(data.potentialSavings) : '-'}
                                                </span>
                                                <p className="text-xs text-gray-400 uppercase tracking-widest mt-1">{t('impactPerMonth')}</p>
                                            </div>
                                        </div>
                                        <div>
                                            <h5 className="text-sm font-bold text-gray-700 mb-1">{t('improvementSuggestion')}</h5>
                                            <p className="text-sm text-gray-600 bg-white p-3 rounded border border-gray-200 shadow-sm leading-relaxed">
                                                {SUGGESTIONS[issueName] || t('defaultSuggestion')}
                                            </p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* HA SECTION */}
                    {haItems.length > 0 && (
                        <div className="mt-12 pt-8 border-t border-gray-200" style={{ pageBreakBefore: "always" }}>
                            <h3 className="text-2xl font-extrabold text-[#0054A6] mb-2 flex items-center">
                                <Cpu className="w-6 h-6 mr-2" />
                                {t('haRisksTitle')}
                            </h3>
                            <p className="text-sm text-gray-500 mb-4">
                                {t('haSummary', { critical: haCounts.critical, high: haCounts.high, medium: haCounts.medium, low: haCounts.low })}
                            </p>
                            <div className="overflow-x-auto">
                                <table className="min-w-full text-xs border-collapse border border-gray-200">
                                    <thead className="bg-gray-100">
                                        <tr>
                                            <th className="border border-gray-200 px-3 py-2 text-left">{t('tableResource')}</th>
                                            <th className="border border-gray-200 px-3 py-2 text-left">{t('tableType')}</th>
                                            <th className="border border-gray-200 px-3 py-2 text-left">{t('tableSeverity')}</th>
                                            <th className="border border-gray-200 px-3 py-2 text-left">{t('tableRisk')}</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {haItems.slice(0, 20).map((it: any, i: number) => (
                                            <tr key={i} className="odd:bg-white even:bg-gray-50">
                                                <td className="border border-gray-200 px-3 py-2 font-semibold">{it.resourceName}</td>
                                                <td className="border border-gray-200 px-3 py-2">{String(it.resourceType || '').split('/').slice(-1)[0]}</td>
                                                <td className="border border-gray-200 px-3 py-2">
                                                    <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                                                        it.severity === 'critical' ? 'bg-rose-100 text-rose-800' :
                                                        it.severity === 'high' ? 'bg-orange-100 text-orange-800' :
                                                        it.severity === 'medium' ? 'bg-amber-100 text-amber-800' :
                                                        'bg-slate-100 text-slate-700'
                                                    }`}>{it.severity}</span>
                                                </td>
                                                <td className="border border-gray-200 px-3 py-2 text-gray-700">{it.estimatedRisk}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    {/* SECCIÓN: TOP CENTROS DE COSTO (Chargeback) */}
                    {chargebackKpi.top.length > 0 && (
                        <div className="mt-12 pt-8 border-t border-gray-200">
                            <h3 className="text-2xl font-extrabold text-[#0054A6] mb-4 flex items-center"><DollarSign className="w-6 h-6 mr-2" />{t('topCostCentersTitle')}</h3>
                            <table className="min-w-full text-xs border-collapse border border-gray-200">
                                <thead className="bg-gray-100"><tr>
                                    <th className="border border-gray-200 px-3 py-2 text-left">{t('tableCenter')}</th>
                                    <th className="border border-gray-200 px-3 py-2 text-right">{t('tableSpend')}</th>
                                    <th className="border border-gray-200 px-3 py-2 text-right">{t('tablePercentOfTotal')}</th>
                                </tr></thead>
                                <tbody>
                                    {(() => {
                                        const total = chargebackKpi.top.reduce((s: number, c: any) => s + Number(c.cost || c.total || 0), 0);
                                        return chargebackKpi.top.map((c: any, i: number) => {
                                            const cost = Number(c.cost || c.total || 0);
                                            const pct = total > 0 ? (cost / total) * 100 : 0;
                                            return (
                                                <tr key={i} className="odd:bg-white even:bg-gray-50">
                                                    <td className="border border-gray-200 px-3 py-2 font-semibold">{c.name || c.costCenter || c.department || '—'}</td>
                                                    <td className="border border-gray-200 px-3 py-2 text-right">{fmtUSD(cost)}</td>
                                                    <td className="border border-gray-200 px-3 py-2 text-right">{pct.toFixed(1)}%</td>
                                                </tr>
                                            );
                                        });
                                    })()}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {/* SECCIÓN: ANOMALÍAS */}
                    {anomaliesKpi.items.length > 0 && (
                        <div className="mt-12 pt-8 border-t border-gray-200">
                            <h3 className="text-2xl font-extrabold text-[#0054A6] mb-2 flex items-center"><AlertCircle className="w-6 h-6 mr-2" />{t('anomaliesTitle')}</h3>
                            <p className="text-sm text-gray-500 mb-4">{t('anomaliesSummary', { count: anomaliesKpi.count, impact: fmtUSD(anomaliesKpi.totalImpact) })}</p>
                            <table className="min-w-full text-xs border-collapse border border-gray-200">
                                <thead className="bg-gray-100"><tr>
                                    <th className="border border-gray-200 px-3 py-2 text-left">{t('tableDate')}</th>
                                    <th className="border border-gray-200 px-3 py-2 text-left">{t('tableResourceService')}</th>
                                    <th className="border border-gray-200 px-3 py-2 text-right">{t('tableImpact')}</th>
                                    <th className="border border-gray-200 px-3 py-2 text-left">{t('tableSeverity')}</th>
                                </tr></thead>
                                <tbody>
                                    {anomaliesKpi.items.map((a: any, i: number) => (
                                        <tr key={i} className="odd:bg-white even:bg-gray-50">
                                            <td className="border border-gray-200 px-3 py-2">{a.date || a.timestamp || '—'}</td>
                                            <td className="border border-gray-200 px-3 py-2">{a.resource || a.service || a.serviceName || a.name || '—'}</td>
                                            <td className="border border-gray-200 px-3 py-2 text-right">{fmtUSD(Number(a.impact || a.deltaCost || 0))}</td>
                                            <td className="border border-gray-200 px-3 py-2">{a.severity || '—'}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {/* SECCIÓN: RIGHT-SIZING */}
                    {rightsizingKpi.items.length > 0 && (
                        <div className="mt-12 pt-8 border-t border-gray-200">
                            <h3 className="text-2xl font-extrabold text-[#0054A6] mb-2 flex items-center"><Cpu className="w-6 h-6 mr-2" />{t('rightsizingTitle')}</h3>
                            <p className="text-sm text-gray-500 mb-4">{t('rightsizingSummary', { count: rightsizingKpi.count, savings: fmtUSD(rightsizingKpi.monthlySav) })}</p>
                            <table className="min-w-full text-xs border-collapse border border-gray-200">
                                <thead className="bg-gray-100"><tr>
                                    <th className="border border-gray-200 px-3 py-2 text-left">{t('tableResource')}</th>
                                    <th className="border border-gray-200 px-3 py-2 text-left">{t('tableCurrentSku')}</th>
                                    <th className="border border-gray-200 px-3 py-2 text-left">{t('tableRecommendedSku')}</th>
                                    <th className="border border-gray-200 px-3 py-2 text-right">{t('tableSavingsPerMonth')}</th>
                                </tr></thead>
                                <tbody>
                                    {rightsizingKpi.items.map((r: any, i: number) => (
                                        <tr key={i} className="odd:bg-white even:bg-gray-50">
                                            <td className="border border-gray-200 px-3 py-2 font-semibold">{r.resourceName || r.name || '—'}</td>
                                            <td className="border border-gray-200 px-3 py-2">{r.currentSku || r.fromSku || '—'}</td>
                                            <td className="border border-gray-200 px-3 py-2">{r.recommendedSku || r.toSku || '—'}</td>
                                            <td className="border border-gray-200 px-3 py-2 text-right text-emerald-700 font-semibold">{fmtUSD(Number(r.monthlySavings || r.estimatedSavings || r.savings || 0))}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {/* SECCIÓN: BUDGETS */}
                    {budgetsKpi.count > 0 && (
                        <div className="mt-12 pt-8 border-t border-gray-200">
                            <h3 className="text-2xl font-extrabold text-[#0054A6] mb-2">{t('budgetExecutionTitle')}</h3>
                            <p className="text-sm text-gray-500 mb-4">
                                {t('budgetSummary', { count: budgetsKpi.count, consumed: fmtUSD(budgetsKpi.totalConsumed), total: fmtUSD(budgetsKpi.totalBudget), pct: budgetsKpi.burnPct.toFixed(1) })}
                                {budgetsKpi.exceeding > 0 && <span className="text-rose-600 font-bold">{t('exceededSuffix', { count: budgetsKpi.exceeding })}</span>}
                            </p>
                            <div className="w-full bg-gray-200 rounded h-4">
                                <div className={`h-4 rounded ${budgetsKpi.burnPct > 100 ? 'bg-rose-600' : budgetsKpi.burnPct > 80 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                                    style={{ width: `${Math.min(100, budgetsKpi.burnPct)}%` }} />
                            </div>
                        </div>
                    )}

                    <div className="mt-12 pt-4 border-t border-gray-200 text-center text-xs text-gray-400">
                        {t('footerGeneratedBy')} <strong>CSCloudSolutions FinOps</strong>. {t('footerDisclaimer')}
                    </div>
                </div>
            </div>
        </div>
    );
}

function KPI({ icon, label, value, sub, color }: { icon: React.ReactNode; label: string; value: string; sub?: string; color: string }) {
    return (
        <div className={`border rounded-lg p-3 ${color}`}>
            <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider opacity-80">
                {icon}{label}
            </div>
            <div className="text-xl font-extrabold mt-1">{value}</div>
            {sub && <div className="text-[10px] opacity-70 mt-0.5">{sub}</div>}
        </div>
    );
}
