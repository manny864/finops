"use client";
import MockBanner from '@/components/MockBanner';
import React, { useEffect, useState, useMemo } from 'react';
import { useTenant } from '@/components/TenantProvider';
import { useMsal } from '@azure/msal-react';
import CostPieChart from '@/components/CostPieChart';
import PdfExportButton from '@/components/PdfExportButton';
import { FileText, AlertCircle, Sparkles, RefreshCw, TrendingUp, TrendingDown, ShieldAlert, DollarSign, Cpu, Leaf } from 'lucide-react';
import { isMockTenant } from '@/lib/mockData';
import { getFreshIdToken } from '@/lib/msalToken';
import { compactPayloadString } from '@/lib/copilotPayload';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

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

function fmtUSD(n: number) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n || 0);
}

export default function ReportGeneratorPage() {
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();

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
    const [history, setHistory] = useState<any>(null);
    const [loadingData, setLoadingData] = useState(false);

    const [aiReport, setAiReport] = useState<string>("");
    const [aiLoading, setAiLoading] = useState(false);
    const [aiError, setAiError] = useState<string | null>(null);

    // ===== Fetch de datos paralelo =====
    useEffect(() => {
        if ((accounts.length === 0 && !isMockTenant(selectedTenant?.id || '')) || selectedTenant.id === 'default') return;

        const run = async () => {
            setLoadingData(true);
            try {
                const idToken = accounts[0] ? await getFreshIdToken(instance, accounts[0]) : '';
                const headers: any = { 'Authorization': `Bearer ${idToken}` };
                const billingHeaders: any = { ...headers, 'x-tenant-id': selectedTenant.id, 'x-subscription-id': 'All' };
                const tid = selectedTenant.id;
                const safe = (p: Promise<Response | null>) => p.then(r => r && r.ok ? r.json() : null).catch(() => null);

                const [
                    auditJ, summaryJ, haJ, forecastJ,
                    tagsJ, commitJ, anomJ, rsJ, budgetJ, ahubJ, chargeJ, histJ
                ] = await Promise.all([
                    safe(fetch(`/api/audit/full?tenantId=${tid}`, { headers })),
                    safe(fetch(`/api/dashboard/summary?tenantId=${tid}&subscriptionId=All`, { headers })),
                    safe(fetch(`/api/governance/ha?tenantId=${tid}`, { headers })),
                    safe(fetch(`/api/intelligence/forecast?tenantId=${tid}&subscriptionId=All`, { headers })),
                    safe(fetch(`/api/tags/compliance?tenantId=${tid}`, { headers })),
                    safe(fetch(`/api/intelligence/commitments?tenantId=${tid}`, { headers })),
                    safe(fetch(`/api/intelligence/anomalies?tenantId=${tid}`, { headers })),
                    safe(fetch(`/api/intelligence/rightsizing?tenantId=${tid}`, { headers })),
                    safe(fetch(`/api/budgets?tenantId=${tid}`, { headers })),
                    safe(fetch(`/api/intelligence/hybrid-benefit?tenantId=${tid}`, { headers })),
                    safe(fetch(`/api/intelligence/chargeback?tenantId=${tid}`, { headers })),
                    safe(fetch(`/api/intelligence/history?tenantId=${tid}&subscriptionId=All`, { headers: billingHeaders })),
                ]);
                setAudit(auditJ); setSummary(summaryJ); setHa(haJ); setForecast(forecastJ);
                setTagCompliance(tagsJ); setCommitments(commitJ); setAnomalies(anomJ);
                setRightsizing(rsJ); setBudgets(budgetJ); setHybridBenefit(ahubJ);
                setChargeback(chargeJ); setHistory(histJ);
            } catch (e) {
                console.warn('[Report] fetch error', e);
            } finally {
                setLoadingData(false);
            }
        };
        run();
    }, [selectedTenant, accounts, instance]);

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
            const k = curr.issue || 'Sin clasificar';
            if (!acc[k]) acc[k] = { count: 0, potentialSavings: 0, type: curr.type, issueType: curr.issueType };
            acc[k].count += 1;
            acc[k].potentialSavings += curr.potentialSavings;
        });
        return Object.entries(acc).sort((a: any, b: any) => b[1].potentialSavings - a[1].potentialSavings);
    }, [mappedFindings]);

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

    const historyKpi = useMemo(() => {
        const h: any = history || {};
        const series = Array.isArray(h.data) ? h.data : (Array.isArray(h.history) ? h.history : []);
        if (series.length < 2) return { prevMonth: 0, deltaPct: 0 };
        const sorted = [...series].sort((a: any, b: any) => String(a.date || a.month).localeCompare(String(b.date || b.month)));
        const prev = Number(sorted[sorted.length - 2]?.cost || sorted[sorted.length - 2]?.amount || 0);
        const curr = Number(sorted[sorted.length - 1]?.cost || sorted[sorted.length - 1]?.amount || actualCost);
        const deltaPct = prev > 0 ? ((curr - prev) / prev) * 100 : 0;
        return { prevMonth: prev, deltaPct };
    }, [history, actualCost]);

    // ===== AI narrative generation =====
    const generateAiReport = async () => {
        setAiError(null);
        setAiLoading(true);
        setAiReport("");

        const compactPayload = {
            tenant: selectedTenant.name,
            scope: 'All subscriptions',
            // §1 Resumen alto nivel
            costs: {
                mtd: actualCost,
                projected: projectedCost,
                deltaVsProjected: projectionDelta,
                previousMonth: historyKpi.prevMonth,
                monthOverMonthPct: Number(historyKpi.deltaPct.toFixed(1)),
                environmentalKgCO2: envImpact
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
            const res = await fetch('/api/intelligence/copilot', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
                body: JSON.stringify({
                    prompt:
                        `Generá un **REPORTE EJECUTIVO FINOPS** para comité directivo del tenant "${selectedTenant.name}". ` +
                        `Basate ESTRICTAMENTE en el payload. Seguí EXACTAMENTE esta estructura (FinOps Foundation framework):\n\n` +
                        `### 1️⃣ Resumen de Alto Nivel\n` +
                        `Tabla Markdown: **Indicador | Valor | Comentario**. Incluí: Gasto Total MTD, Proyección fin de mes, Variación vs mes anterior (%), Costo como % del margen estimado (si no hay margen → "n/d, requiere input financiero"), Impacto CO₂.\n` +
                        `Cerrá con 2-3 líneas de lectura ejecutiva del estado financiero general.\n\n` +
                        `### 2️⃣ Visibilidad y Asignación de Costos\n` +
                        `- **Asignación correcta**: X% del gasto etiquetado por departamento/centro de costos.\n` +
                        `- **Costos no asignados**: X% (recursos huérfanos o compartidos requieren acción de ingeniería).\n` +
                        `- **Top 3 Centros de Costo** (tabla: Centro | Gasto USD | % del total).\n` +
                        `Si el chargeback está vacío → recomendá implementación de tagging policy.\n\n` +
                        `### 3️⃣ Oportunidades de Optimización y Ahorro\n` +
                        `- **Ahorro potencial mensual**: $X (anualizado $Y) consolidando todas las fuentes (waste audit + right-sizing + AHUB).\n` +
                        `- **Cobertura de compromisos**: X% en RI/Savings Plans vs objetivo recomendado 70%+.\n` +
                        `- **Right-sizing**: N recursos subutilizados → ahorro $X/mes.\n` +
                        `- **Azure Hybrid Benefit**: N VMs elegibles / N habilitadas → potencial $X/año adicional.\n` +
                        `Tabla **Top 5 oportunidades**: Iniciativa | Ahorro $/mes | Esfuerzo | Riesgo de cambio | Tiempo a valor.\n\n` +
                        `### 4️⃣ Gobernanza y Gestión de Anomalías\n` +
                        `- **Eventos anómalos detectados**: N picos de consumo este período, impacto agregado $X. Listá top 3 con fecha/recurso/causa hipotética.\n` +
                        `- **Presupuesto vs Real**: Ejecución X% del presupuesto (N de M presupuestos excedidos). Si no hay budgets configurados → recomendá creación.\n` +
                        `- **Riesgos de Alta Disponibilidad**: N críticos+altos (tabla top 5: Recurso | Tipo | Severidad | Mitigación).\n\n` +
                        `### 5️⃣ Recomendaciones Estratégicas\n` +
                        `Tabla **Plan 30/60/90 días**: Horizonte | Acción | Owner sugerido | Ahorro esperado | KPI de éxito (6-9 filas).\n` +
                        `Incluí explícitamente: automatización (apagado fuera de horario), estandarización FOCUS, mejora de tagging policy, expansión de commitments coverage.\n\n` +
                        `### 🧭 Veredicto Ejecutivo\n` +
                        `3-4 líneas: estado general (saludable / requiere atención / acción urgente), prioridad #1 inmediata, presupuesto sugerido próximo mes.\n\n` +
                        `**REGLAS ESTRICTAS**:\n` +
                        `- TODAS las cifras del payload (USD, %, conteos). NUNCA inventes valores.\n` +
                        `- Si un dato falta → "n/d" y explicá en Gobernanza qué se necesita.\n` +
                        `- Acciones con verbos accionables (eliminar, redimensionar, migrar, programar, etiquetar, comprar reserva).\n` +
                        `- Tono: profesional, decisorio, sin disclaimers. Markdown válido con tablas GFM.\n` +
                        `- Extensión objetivo: 900-1200 palabras.`,
                    pageContext: 'Reporte Ejecutivo FinOps Integral',
                    dataPayload: compactPayloadString(compactPayload),
                    tenantId: selectedTenant.id,
                    locale: 'es'
                })
            });
            if (!res.ok || !res.body) {
                const t = await res.text();
                throw new Error(`HTTP ${res.status}: ${t.slice(0, 200)}`);
            }
            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let acc = '';
            while (true) {
                const { value, done } = await reader.read();
                if (done) break;
                acc += decoder.decode(value, { stream: true });
                setAiReport(acc);
            }
            acc += decoder.decode();
            setAiReport(acc);
        } catch (e: any) {
            setAiError(e?.message || 'Error al generar el reporte IA');
        } finally {
            setAiLoading(false);
        }
    };

    // Auto-trigger AI report cuando llegan los datos
    useEffect(() => {
        if (!loadingData && audit && !aiReport && !aiLoading && !aiError) {
            generateAiReport();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [loadingData, audit]);

    if (selectedTenant.id === 'default') {
        return (
            <div className="flex flex-col items-center justify-center h-96 bg-white rounded-lg border border-gray-200 shadow-sm">
                <span className="text-4xl mb-4">🔐</span>
                <h2 className="text-xl font-bold text-gray-700">Selecciona un Tenant</h2>
                <p className="text-sm text-gray-500 mt-2">Debes seleccionar una organización para exportar el reporte.</p>
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
                        Reporte Ejecutivo
                    </h1>
                    <p className="text-gray-500 dark:text-gray-400 mt-2">
                        Documento integral generado por IA con datos en vivo: costos, ahorros, alta disponibilidad y plan de acción.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={generateAiReport}
                        disabled={aiLoading || loadingData}
                        className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-semibold disabled:opacity-50"
                    >
                        {aiLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                        {aiLoading ? 'Generando…' : 'Regenerar IA'}
                    </button>
                    <PdfExportButton targetId="pdf-export-area" tenantName={selectedTenant.name} />
                </div>
            </div>

            <div className="bg-gray-100 dark:bg-slate-800 p-8 rounded-xl border border-gray-200 dark:border-slate-700">
                <div className="mb-4 flex items-center text-sm font-bold text-gray-500 uppercase tracking-wider">
                    <AlertCircle className="w-4 h-4 mr-2" /> Document Preview
                </div>

                <div id="pdf-export-area" className="bg-white p-8 rounded-lg shadow-lg border border-gray-200 text-gray-900" style={{ width: '100%', minHeight: '800px' }}>
                    {/* HEADER */}
                    <div className="text-center mb-8 border-b border-gray-200 pb-6">
                        <h2 className="text-3xl font-extrabold text-[#0054A6]">FinOps Audit Executive Summary</h2>
                        <p className="text-gray-500 mt-2 text-lg">Organization: {selectedTenant.name}</p>
                        <p className="text-gray-400 mt-1 text-sm">Generado: {new Date().toLocaleString('es-AR')}</p>
                    </div>

                    {/* KPI STRIP (10 indicadores en 2 filas) */}
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
                        <KPI icon={<DollarSign className="w-4 h-4" />} label="Gasto MTD" value={fmtUSD(actualCost)} sub={historyKpi.deltaPct ? `${historyKpi.deltaPct > 0 ? '+' : ''}${historyKpi.deltaPct.toFixed(1)}% vs mes ant.` : undefined} color="text-blue-700 bg-blue-50 border-blue-200" />
                        <KPI icon={<TrendingUp className="w-4 h-4" />} label="Proyección mes" value={fmtUSD(projectedCost)} color="text-indigo-700 bg-indigo-50 border-indigo-200" />
                        <KPI icon={<TrendingDown className="w-4 h-4" />} label="Ahorro mensual" value={fmtUSD(totalSavings)} sub={`Anualizado ${fmtUSD(annualSavings)}`} color="text-emerald-700 bg-emerald-50 border-emerald-200" />
                        <KPI icon={<ShieldAlert className="w-4 h-4" />} label="HA Críticos+Altos" value={String(haCritical)} sub={`${haItems.length} total`} color="text-rose-700 bg-rose-50 border-rose-200" />
                        <KPI icon={<Leaf className="w-4 h-4" />} label="Impacto CO₂" value={`${envImpact} kg`} color="text-green-700 bg-green-50 border-green-200" />
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-10">
                        <KPI icon={<DollarSign className="w-4 h-4" />} label="Tagging cobertura" value={`${tagging.pct.toFixed(0)}%`} sub={tagging.total ? `${tagging.tagged}/${tagging.total}` : 'n/d'} color="text-cyan-700 bg-cyan-50 border-cyan-200" />
                        <KPI icon={<TrendingUp className="w-4 h-4" />} label="Commitments" value={`${commitmentsKpi.coverage.toFixed(0)}%`} sub={commitmentsKpi.annualSav ? `Ahorro ${fmtUSD(commitmentsKpi.annualSav)}/año` : undefined} color="text-purple-700 bg-purple-50 border-purple-200" />
                        <KPI icon={<Cpu className="w-4 h-4" />} label="Right-sizing" value={String(rightsizingKpi.count)} sub={rightsizingKpi.monthlySav ? `${fmtUSD(rightsizingKpi.monthlySav)}/mes` : 'n/d'} color="text-orange-700 bg-orange-50 border-orange-200" />
                        <KPI icon={<AlertCircle className="w-4 h-4" />} label="Anomalías" value={String(anomaliesKpi.count)} sub={anomaliesKpi.totalImpact ? `Impacto ${fmtUSD(anomaliesKpi.totalImpact)}` : 'sin alertas'} color="text-yellow-700 bg-yellow-50 border-yellow-200" />
                        <KPI icon={<DollarSign className="w-4 h-4" />} label="Budget burn" value={budgetsKpi.totalBudget > 0 ? `${budgetsKpi.burnPct.toFixed(0)}%` : 'n/d'} sub={budgetsKpi.exceeding ? `${budgetsKpi.exceeding} excedidos` : `${budgetsKpi.count} configurados`} color={budgetsKpi.burnPct > 90 ? "text-rose-700 bg-rose-50 border-rose-200" : "text-slate-700 bg-slate-50 border-slate-200"} />
                    </div>

                    {/* AI NARRATIVE */}
                    <div className="mb-10">
                        <h3 className="text-2xl font-extrabold text-[#0054A6] mb-4 flex items-center">
                            <Sparkles className="w-6 h-6 mr-2 text-indigo-600" />
                            Análisis Ejecutivo Generado por IA
                        </h3>
                        <div className="bg-gradient-to-br from-indigo-50 to-blue-50 border border-indigo-100 rounded-xl p-6 overflow-hidden">
                            {aiLoading && !aiReport && (
                                <div className="flex items-center gap-2 text-indigo-600 text-sm py-8 justify-center">
                                    <RefreshCw className="w-4 h-4 animate-spin" />
                                    Generando análisis ejecutivo con IA sobre {findingsCount} hallazgos y {haItems.length} ítems de HA…
                                </div>
                            )}
                            {aiError && (
                                <div className="text-rose-700 text-sm bg-rose-50 border border-rose-200 rounded p-3">
                                    <strong>Error al generar el reporte IA:</strong> {aiError}
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
                        <h3 className="text-xl font-bold text-gray-800 mb-4 text-center border-b border-gray-100 pb-2">Distribución de Ineficiencias</h3>
                        {loadingData ? (
                            <div className="h-64 flex items-center justify-center text-gray-400 animate-pulse">Calculando gráficas…</div>
                        ) : mappedFindings.length > 0 ? (
                            <div className="h-80"><CostPieChart data={mappedFindings} onSegmentClick={() => {}} /></div>
                        ) : (
                            <div className="text-center text-gray-500 py-10">Entorno 100% optimizado.</div>
                        )}
                    </div>

                    {/* HALLAZGOS DETALLADOS */}
                    <div className="mt-12 pt-8 border-t border-gray-200" style={{ pageBreakBefore: groupedIssues.length > 0 ? "always" : "auto" }}>
                        <h3 className="text-2xl font-extrabold text-[#0054A6] mb-6">Hallazgos y Plan de Remediación</h3>
                        {groupedIssues.length === 0 ? (
                            <p className="text-gray-500 text-center py-4">No hay hallazgos críticos detectados en este escaneo.</p>
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
                                                    <span className="font-semibold text-gray-700">{data.count}</span> recurso(s) · Tipo: {data.type}
                                                </p>
                                            </div>
                                            <div className="text-right">
                                                <span className={`text-lg font-extrabold ${data.potentialSavings > 0 ? 'text-green-600' : 'text-gray-400'}`}>
                                                    {data.potentialSavings > 0 ? fmtUSD(data.potentialSavings) : '-'}
                                                </span>
                                                <p className="text-xs text-gray-400 uppercase tracking-widest mt-1">Impacto / Mes</p>
                                            </div>
                                        </div>
                                        <div>
                                            <h5 className="text-sm font-bold text-gray-700 mb-1">Sugerencia de Mejora:</h5>
                                            <p className="text-sm text-gray-600 bg-white p-3 rounded border border-gray-200 shadow-sm leading-relaxed">
                                                {SUGGESTIONS[issueName] || "Revisar y auditar estos recursos manualmente para determinar si son necesarios en la arquitectura actual."}
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
                                Riesgos de Alta Disponibilidad
                            </h3>
                            <p className="text-sm text-gray-500 mb-4">
                                {haCounts.critical} críticos · {haCounts.high} altos · {haCounts.medium} medios · {haCounts.low} bajos
                            </p>
                            <div className="overflow-x-auto">
                                <table className="min-w-full text-xs border-collapse border border-gray-200">
                                    <thead className="bg-gray-100">
                                        <tr>
                                            <th className="border border-gray-200 px-3 py-2 text-left">Recurso</th>
                                            <th className="border border-gray-200 px-3 py-2 text-left">Tipo</th>
                                            <th className="border border-gray-200 px-3 py-2 text-left">Severidad</th>
                                            <th className="border border-gray-200 px-3 py-2 text-left">Riesgo</th>
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
                            <h3 className="text-2xl font-extrabold text-[#0054A6] mb-4 flex items-center"><DollarSign className="w-6 h-6 mr-2" />Top Centros de Costo</h3>
                            <table className="min-w-full text-xs border-collapse border border-gray-200">
                                <thead className="bg-gray-100"><tr>
                                    <th className="border border-gray-200 px-3 py-2 text-left">Centro</th>
                                    <th className="border border-gray-200 px-3 py-2 text-right">Gasto</th>
                                    <th className="border border-gray-200 px-3 py-2 text-right">% del total</th>
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
                            <h3 className="text-2xl font-extrabold text-[#0054A6] mb-2 flex items-center"><AlertCircle className="w-6 h-6 mr-2" />Anomalías de Costo Detectadas</h3>
                            <p className="text-sm text-gray-500 mb-4">{anomaliesKpi.count} eventos · Impacto agregado {fmtUSD(anomaliesKpi.totalImpact)}</p>
                            <table className="min-w-full text-xs border-collapse border border-gray-200">
                                <thead className="bg-gray-100"><tr>
                                    <th className="border border-gray-200 px-3 py-2 text-left">Fecha</th>
                                    <th className="border border-gray-200 px-3 py-2 text-left">Recurso / Servicio</th>
                                    <th className="border border-gray-200 px-3 py-2 text-right">Impacto</th>
                                    <th className="border border-gray-200 px-3 py-2 text-left">Severidad</th>
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
                            <h3 className="text-2xl font-extrabold text-[#0054A6] mb-2 flex items-center"><Cpu className="w-6 h-6 mr-2" />Top Recomendaciones de Right-Sizing</h3>
                            <p className="text-sm text-gray-500 mb-4">{rightsizingKpi.count} recursos · Ahorro potencial {fmtUSD(rightsizingKpi.monthlySav)}/mes</p>
                            <table className="min-w-full text-xs border-collapse border border-gray-200">
                                <thead className="bg-gray-100"><tr>
                                    <th className="border border-gray-200 px-3 py-2 text-left">Recurso</th>
                                    <th className="border border-gray-200 px-3 py-2 text-left">SKU actual</th>
                                    <th className="border border-gray-200 px-3 py-2 text-left">SKU recomendado</th>
                                    <th className="border border-gray-200 px-3 py-2 text-right">Ahorro $/mes</th>
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
                            <h3 className="text-2xl font-extrabold text-[#0054A6] mb-2">Ejecución Presupuestaria</h3>
                            <p className="text-sm text-gray-500 mb-4">
                                {budgetsKpi.count} presupuestos configurados · {fmtUSD(budgetsKpi.totalConsumed)} de {fmtUSD(budgetsKpi.totalBudget)} consumido ({budgetsKpi.burnPct.toFixed(1)}%)
                                {budgetsKpi.exceeding > 0 && <span className="text-rose-600 font-bold"> · {budgetsKpi.exceeding} excedidos</span>}
                            </p>
                            <div className="w-full bg-gray-200 rounded h-4">
                                <div className={`h-4 rounded ${budgetsKpi.burnPct > 100 ? 'bg-rose-600' : budgetsKpi.burnPct > 80 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                                    style={{ width: `${Math.min(100, budgetsKpi.burnPct)}%` }} />
                            </div>
                        </div>
                    )}

                    <div className="mt-12 pt-4 border-t border-gray-200 text-center text-xs text-gray-400">
                        Documento generado automáticamente por <strong>CSCloudSolutions FinOps</strong>. La sección de análisis IA puede contener interpretaciones; valide cifras antes de tomar decisiones operativas.
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
