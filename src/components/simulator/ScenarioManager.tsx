"use client";
import React, { useEffect, useState, useCallback } from "react";
import { useTenant } from "@/components/TenantProvider";
import { useMsal } from "@azure/msal-react";
import { getFreshIdToken } from "@/lib/msalToken";
import { isMockTenant } from "@/lib/mockData";
import { toast } from "sonner";
import { Save, Trash2, GitCompare, Plus, Bookmark, X, Loader2, Download } from "lucide-react";

export interface SavedScenario {
    id: string;
    name: string;
    notes: string | null;
    userEmail: string;
    inputs: {
        computeScale?: number;
        storageScale?: number;
        networkIncrease?: number;
        applyAhb?: boolean;
    };
    baseCost: number;
    projectedCost: number;
    delta: number;
    deltaPct: number;
    breakdown: { compute: number; storage: number; network: number };
    currency: string;
    createdAt: string;
}

interface Props {
    /** Current simulator inputs (API shape: scale 1.0, networkIncrease in %). */
    currentInputs: {
        computeScale: number;
        storageScale: number;
        networkIncrease: number;
        applyAhb: boolean;
    };
    /** Current resolved baseCost (from /api/intelligence/simulator response). */
    currentBaseCost: number | null;
    /** Currency for display (defaults USD). */
    currency?: string;
}

function fmt(amount: number, currency = "USD") {
    return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency,
        maximumFractionDigits: 0,
    }).format(amount);
}

/** Escapa un valor para una celda CSV (RFC 4180). */
function csvCell(value: string | number | boolean | null | undefined): string {
    const s = value === null || value === undefined ? "" : String(value);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Dispara la descarga de un string como archivo en el browser. */
function downloadTextFile(filename: string, content: string, mime = "text/csv;charset=utf-8;") {
    const blob = new Blob(["\uFEFF" + content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

/** CSV de un único escenario, con todos los inputs y resultados. */
function scenarioToCsv(s: SavedScenario): string {
    const rows: [string, string | number][] = [
        ["Nombre", s.name],
        ["Notas", s.notes || ""],
        ["Creado", s.createdAt],
        ["Moneda", s.currency],
        ["Compute Scale", s.inputs.computeScale ?? 1],
        ["Storage Scale", s.inputs.storageScale ?? 1],
        ["Network Increase (%)", s.inputs.networkIncrease ?? 0],
        ["Azure Hybrid Benefit", s.inputs.applyAhb ? "ON" : "OFF"],
        ["Costo Base", s.baseCost],
        ["Costo Proyectado", s.projectedCost],
        ["Delta", s.delta],
        ["Delta %", s.deltaPct],
        ["Compute (proyectado)", s.breakdown.compute],
        ["Storage (proyectado)", s.breakdown.storage],
        ["Network (proyectado)", s.breakdown.network],
    ];
    return ["Campo,Valor", ...rows.map(([k, v]) => `${csvCell(k)},${csvCell(v)}`)].join("\n");
}

/** CSV con todos los escenarios guardados, uno por fila. */
function scenariosListToCsv(scenarios: SavedScenario[]): string {
    const header = [
        "Nombre", "Notas", "Moneda", "Compute Scale", "Storage Scale", "Network Increase (%)",
        "AHB", "Costo Base", "Costo Proyectado", "Delta", "Delta %", "Compute", "Storage", "Network", "Creado",
    ];
    const lines = scenarios.map((s) => [
        s.name, s.notes || "", s.currency, s.inputs.computeScale ?? 1, s.inputs.storageScale ?? 1,
        s.inputs.networkIncrease ?? 0, s.inputs.applyAhb ? "ON" : "OFF", s.baseCost, s.projectedCost,
        s.delta, s.deltaPct, s.breakdown.compute, s.breakdown.storage, s.breakdown.network, s.createdAt,
    ].map(csvCell).join(","));
    return [header.map(csvCell).join(","), ...lines].join("\n");
}

/** CSV de comparación lado-a-lado (escenarios en columnas). */
function comparisonToCsv(scenarios: SavedScenario[]): string {
    const baseline = scenarios[0];
    const metricRows: [string, (s: SavedScenario) => string | number][] = [
        ["Costo Base", (s) => s.baseCost],
        ["Costo Proyectado", (s) => s.projectedCost],
        ["Delta % vs propio base", (s) => s.deltaPct],
        ["Delta % vs línea base (" + baseline.name + ")", (s) => {
            if (s.id === baseline.id) return 0;
            const dProj = s.projectedCost - baseline.projectedCost;
            return baseline.projectedCost > 0 ? Math.round((dProj / baseline.projectedCost) * 1000) / 10 : 0;
        }],
        ["Compute (proyectado)", (s) => s.breakdown.compute],
        ["Storage (proyectado)", (s) => s.breakdown.storage],
        ["Network (proyectado)", (s) => s.breakdown.network],
        ["Compute ×", (s) => s.inputs.computeScale ?? 1],
        ["Storage ×", (s) => s.inputs.storageScale ?? 1],
        ["Network Δ (%)", (s) => s.inputs.networkIncrease ?? 0],
        ["AHB", (s) => (s.inputs.applyAhb ? "ON" : "OFF")],
    ];
    const header = ["Métrica", ...scenarios.map((s) => s.name)];
    const lines = metricRows.map(([label, fn]) => [label, ...scenarios.map((s) => fn(s))].map(csvCell).join(","));
    return [header.map(csvCell).join(","), ...lines].join("\n");
}

export default function ScenarioManager({ currentInputs, currentBaseCost, currency = "USD" }: Props) {
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();

    const [scenarios, setScenarios] = useState<SavedScenario[]>([]);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [showSave, setShowSave] = useState(false);
    const [name, setName] = useState("");
    const [notes, setNotes] = useState("");
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [compareOpen, setCompareOpen] = useState(false);

    const authHeaders = useCallback(async (): Promise<Record<string, string>> => {
        if (isMockTenant(selectedTenant?.id || "") || accounts.length === 0) return {};
        const idToken = await getFreshIdToken(instance, accounts[0]);
        return { Authorization: `Bearer ${idToken}` };
    }, [instance, accounts, selectedTenant]);

    const fetchScenarios = useCallback(async () => {
        if (!selectedTenant || selectedTenant.id === "default") return;
        setLoading(true);
        try {
            const headers = await authHeaders();
            const res = await fetch(
                `/api/intelligence/simulator/scenarios?tenantId=${selectedTenant.id}`,
                { headers }
            );
            if (!res.ok) {
                const j = await res.json().catch(() => ({}));
                toast.error(j.error || "No se pudieron cargar los escenarios.");
                return;
            }
            const j = await res.json();
            setScenarios(j.scenarios || []);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    }, [selectedTenant, authHeaders]);

    useEffect(() => { fetchScenarios(); }, [fetchScenarios]);

    async function handleSave() {
        if (!name.trim()) {
            toast.error("Poné un nombre al escenario.");
            return;
        }
        if (!currentBaseCost) {
            toast.error("Ejecutá una simulación primero para fijar el baseCost.");
            return;
        }
        setSaving(true);
        try {
            const headers = { ...(await authHeaders()), "Content-Type": "application/json" };
            const res = await fetch("/api/intelligence/simulator/scenarios", {
                method: "POST",
                headers,
                body: JSON.stringify({
                    tenantId: selectedTenant.id,
                    name: name.trim(),
                    notes: notes.trim() || undefined,
                    inputs: currentInputs,
                    baseCost: currentBaseCost,
                    currency,
                }),
            });
            if (!res.ok) {
                const j = await res.json().catch(() => ({}));
                toast.error(j.error || "Error al guardar.");
                return;
            }
            toast.success(`Escenario "${name}" guardado.`);
            setShowSave(false);
            setName("");
            setNotes("");
            await fetchScenarios();
        } finally {
            setSaving(false);
        }
    }

    async function handleDelete(id: string) {
        if (!confirm("¿Borrar este escenario?")) return;
        const headers = await authHeaders();
        const res = await fetch(
            `/api/intelligence/simulator/scenarios/${id}?tenantId=${selectedTenant.id}`,
            { method: "DELETE", headers }
        );
        if (!res.ok) {
            const j = await res.json().catch(() => ({}));
            toast.error(j.error || "Error al borrar.");
            return;
        }
        toast.success("Escenario borrado.");
        setSelected((s) => {
            const n = new Set(s);
            n.delete(id);
            return n;
        });
        await fetchScenarios();
    }

    function toggleSelect(id: string) {
        setSelected((prev) => {
            const n = new Set(prev);
            if (n.has(id)) n.delete(id);
            else {
                if (n.size >= 4) {
                    toast.error("Máximo 4 escenarios para comparar.");
                    return prev;
                }
                n.add(id);
            }
            return n;
        });
    }

    const selectedScenarios = scenarios.filter((s) => selected.has(s.id));

    return (
        <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 p-6 mt-6">
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                    <Bookmark className="w-5 h-5 text-indigo-500" />
                    Escenarios Guardados
                </h3>
                <div className="flex gap-2">
                    <button
                        onClick={() => setShowSave(true)}
                        disabled={!currentBaseCost}
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
                    >
                        <Plus className="w-3.5 h-3.5" /> Guardar actual
                    </button>
                    <button
                        onClick={() => downloadTextFile(`escenarios-whatif-${new Date().toISOString().slice(0, 10)}.csv`, scenariosListToCsv(scenarios))}
                        disabled={scenarios.length === 0}
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-md bg-gray-100 dark:bg-slate-800 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-slate-700 disabled:opacity-50"
                        title="Descargar todos los escenarios guardados (CSV)"
                    >
                        <Download className="w-3.5 h-3.5" /> Descargar todo
                    </button>
                    <button
                        onClick={() => setCompareOpen(true)}
                        disabled={selected.size < 2}
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-md bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                    >
                        <GitCompare className="w-3.5 h-3.5" /> Comparar ({selected.size})
                    </button>
                </div>
            </div>

            {loading ? (
                <div className="text-center py-8 text-gray-400">
                    <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
                    Cargando escenarios...
                </div>
            ) : scenarios.length === 0 ? (
                <p className="text-sm text-gray-500 text-center py-6">
                    No hay escenarios guardados. Ejecutá una simulación y hacé clic en <strong>Guardar actual</strong>.
                </p>
            ) : (
                <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                        <thead className="bg-gray-50 dark:bg-slate-800 text-xs uppercase text-gray-500">
                            <tr>
                                <th className="px-3 py-2 text-left"></th>
                                <th className="px-3 py-2 text-left">Nombre</th>
                                <th className="px-3 py-2 text-right">Base</th>
                                <th className="px-3 py-2 text-right">Proyectado</th>
                                <th className="px-3 py-2 text-right">Δ %</th>
                                <th className="px-3 py-2 text-left">Creado</th>
                                <th className="px-3 py-2"></th>
                            </tr>
                        </thead>
                        <tbody>
                            {scenarios.map((s) => (
                                <tr key={s.id} className="border-t border-gray-100 dark:border-slate-800 hover:bg-gray-50 dark:hover:bg-slate-800/50">
                                    <td className="px-3 py-2">
                                        <input
                                            type="checkbox"
                                            checked={selected.has(s.id)}
                                            onChange={() => toggleSelect(s.id)}
                                            className="accent-indigo-600"
                                            aria-label={`Seleccionar ${s.name}`}
                                        />
                                    </td>
                                    <td className="px-3 py-2 font-medium text-gray-900 dark:text-gray-100">
                                        {s.name}
                                        {s.notes && <div className="text-xs text-gray-500 mt-0.5">{s.notes}</div>}
                                    </td>
                                    <td className="px-3 py-2 text-right text-gray-700 dark:text-gray-300">{fmt(s.baseCost, s.currency)}</td>
                                    <td className={`px-3 py-2 text-right font-semibold ${s.delta < 0 ? "text-emerald-600" : "text-rose-600"}`}>
                                        {fmt(s.projectedCost, s.currency)}
                                    </td>
                                    <td className={`px-3 py-2 text-right text-xs ${s.deltaPct < 0 ? "text-emerald-600" : "text-rose-600"}`}>
                                        {s.deltaPct >= 0 ? "+" : ""}{s.deltaPct}%
                                    </td>
                                    <td className="px-3 py-2 text-xs text-gray-500">{new Date(s.createdAt).toLocaleDateString()}</td>
                                    <td className="px-3 py-2 text-right whitespace-nowrap">
                                        <button
                                            onClick={() => downloadTextFile(`escenario-${s.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.csv`, scenarioToCsv(s))}
                                            className="text-gray-400 hover:text-indigo-600 mr-2"
                                            aria-label={`Descargar ${s.name}`}
                                            title="Descargar este escenario (CSV)"
                                        >
                                            <Download className="w-4 h-4" />
                                        </button>
                                        <button
                                            onClick={() => handleDelete(s.id)}
                                            className="text-rose-500 hover:text-rose-700"
                                            aria-label="Borrar escenario"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {showSave && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
                    <div className="bg-white dark:bg-slate-900 rounded-xl shadow-xl p-6 w-full max-w-md">
                        <div className="flex items-center justify-between mb-4">
                            <h4 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                                <Save className="w-5 h-5 text-indigo-500" /> Guardar escenario
                            </h4>
                            <button onClick={() => setShowSave(false)}><X className="w-5 h-5 text-gray-500" /></button>
                        </div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">Nombre *</label>
                        <input
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            maxLength={120}
                            placeholder="Ej: Migración prod 2026Q3"
                            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                        <label className="block text-xs font-medium text-gray-700 mb-1">Notas (opcional)</label>
                        <textarea
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            rows={3}
                            maxLength={2000}
                            placeholder="Hipótesis, supuestos, contexto..."
                            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                        <div className="text-xs text-gray-500 bg-gray-50 dark:bg-slate-800 p-2 rounded mb-4">
                            Inputs actuales: compute ×{currentInputs.computeScale}, storage ×{currentInputs.storageScale},
                            network {currentInputs.networkIncrease > 0 ? "+" : ""}{currentInputs.networkIncrease}%
                            {currentInputs.applyAhb ? ", AHB ON" : ""}
                            <br />
                            Base: <strong>{currentBaseCost ? fmt(currentBaseCost, currency) : "—"}</strong>
                        </div>
                        <button
                            onClick={handleSave}
                            disabled={saving}
                            className="w-full py-2 bg-indigo-600 text-white rounded-md text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
                        >
                            {saving ? "Guardando..." : "Guardar escenario"}
                        </button>
                    </div>
                </div>
            )}

            {compareOpen && selectedScenarios.length >= 2 && (
                <CompareModal
                    scenarios={selectedScenarios}
                    onClose={() => setCompareOpen(false)}
                />
            )}
        </div>
    );
}

function CompareModal({ scenarios, onClose }: { scenarios: SavedScenario[]; onClose: () => void }) {
    const baseline = scenarios[0];
    const gridCols = scenarios.length === 2 ? "md:grid-cols-2" : scenarios.length === 3 ? "md:grid-cols-3" : "md:grid-cols-4";
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl p-6 w-full max-w-5xl max-h-[90vh] overflow-y-auto">
                <div className="flex items-center justify-between mb-6">
                    <h3 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
                        <GitCompare className="w-6 h-6 text-emerald-500" /> Comparación lado-a-lado
                    </h3>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => downloadTextFile(`comparacion-whatif-${new Date().toISOString().slice(0, 10)}.csv`, comparisonToCsv(scenarios))}
                            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-md bg-emerald-600 text-white hover:bg-emerald-700"
                            title="Descargar esta comparación (CSV)"
                        >
                            <Download className="w-3.5 h-3.5" /> Descargar comparación
                        </button>
                        <button onClick={onClose}><X className="w-5 h-5 text-gray-500" /></button>
                    </div>
                </div>
                <p className="text-xs text-gray-500 mb-4">
                    Línea base: <strong>{baseline.name}</strong>. Las diferencias (Δ) se calculan respecto a ella.
                </p>
                <div className={`grid grid-cols-1 ${gridCols} gap-4`}>
                    {scenarios.map((s, idx) => {
                        const isBaseline = idx === 0;
                        const dProj = s.projectedCost - baseline.projectedCost;
                        const dProjPct = baseline.projectedCost > 0 ? (dProj / baseline.projectedCost) * 100 : 0;
                        return (
                            <div
                                key={s.id}
                                className={`border rounded-lg p-4 ${isBaseline ? "border-indigo-300 bg-indigo-50 dark:bg-indigo-950/30" : "border-gray-200 dark:border-slate-700"}`}
                            >
                                <div className="flex items-center justify-between mb-2">
                                    <h4 className="font-semibold text-gray-900 dark:text-white text-sm">{s.name}</h4>
                                    {isBaseline && <span className="text-[10px] bg-indigo-600 text-white px-1.5 py-0.5 rounded">BASE</span>}
                                </div>
                                {s.notes && <p className="text-xs text-gray-500 italic mb-2">{s.notes}</p>}
                                <dl className="text-xs space-y-1.5">
                                    <Row label="Base" value={fmt(s.baseCost, s.currency)} />
                                    <Row label="Proyectado" value={fmt(s.projectedCost, s.currency)} strong />
                                    <Row label="Δ vs Base" value={`${s.deltaPct >= 0 ? "+" : ""}${s.deltaPct}%`} color={s.deltaPct >= 0 ? "rose" : "emerald"} />
                                    {!isBaseline && (
                                        <Row
                                            label={`Δ vs ${baseline.name.length > 12 ? baseline.name.slice(0, 12) + "…" : baseline.name}`}
                                            value={`${dProjPct >= 0 ? "+" : ""}${Math.round(dProjPct * 10) / 10}%`}
                                            color={dProjPct >= 0 ? "rose" : "emerald"}
                                        />
                                    )}
                                    <hr className="my-2 border-gray-200 dark:border-slate-700" />
                                    <Row label="Compute" value={fmt(s.breakdown.compute, s.currency)} />
                                    <Row label="Storage" value={fmt(s.breakdown.storage, s.currency)} />
                                    <Row label="Network" value={fmt(s.breakdown.network, s.currency)} />
                                    <hr className="my-2 border-gray-200 dark:border-slate-700" />
                                    <Row label="Compute ×" value={`${s.inputs.computeScale ?? 1}`} />
                                    <Row label="Storage ×" value={`${s.inputs.storageScale ?? 1}`} />
                                    <Row label="Network Δ" value={`${(s.inputs.networkIncrease ?? 0) > 0 ? "+" : ""}${s.inputs.networkIncrease ?? 0}%`} />
                                    <Row label="AHB" value={s.inputs.applyAhb ? "ON" : "OFF"} />
                                </dl>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}

function Row({ label, value, strong, color }: { label: string; value: string; strong?: boolean; color?: "rose" | "emerald" }) {
    const colorCls = color === "rose" ? "text-rose-600 dark:text-rose-400" : color === "emerald" ? "text-emerald-600 dark:text-emerald-400" : "";
    return (
        <div className="flex justify-between">
            <dt className="text-gray-500">{label}</dt>
            <dd className={`${strong ? "font-bold" : "font-medium"} ${colorCls || "text-gray-900 dark:text-gray-100"}`}>{value}</dd>
        </div>
    );
}
