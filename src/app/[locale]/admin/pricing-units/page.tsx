"use client";
import React, { useEffect, useState, useCallback } from "react";
import { Database, Loader2, RefreshCw, Play, Search } from "lucide-react";
import { useMsal } from "@azure/msal-react";
import { fetchWithAuthRetry } from "@/lib/msalToken";

interface UnitRow {
    uom_raw: string;
    block_size: string;
    base_unit: string;
    display_unit: string;
    category: string;
}

export default function PricingUnitsPage() {
    const { instance, accounts } = useMsal();
    const account = accounts[0];
    const [units, setUnits] = useState<UnitRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [reseeding, setReseeding] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [info, setInfo] = useState<string | null>(null);
    const [filter, setFilter] = useState("");
    const [testUom, setTestUom] = useState("100 Hours");
    const [testQty, setTestQty] = useState("7.3");
    const [testResult, setTestResult] = useState<any>(null);

    const load = useCallback(async () => {
        setLoading(true); setError(null);
        try {
            const res = await fetchWithAuthRetry(instance, account, "/api/admin/pricing-units");
            const json = await res.json();
            if (!json.success) setError(json.error || "Error");
            else setUnits(json.items || []);
        } catch (e: any) { setError(e?.message); }
        finally { setLoading(false); }
    }, [instance, account]);

    useEffect(() => { load(); }, [load]);

    const reseed = async () => {
        setReseeding(true); setError(null); setInfo(null);
        try {
            const res = await fetchWithAuthRetry(instance, account, "/api/admin/pricing-units", { method: "POST" });
            const json = await res.json();
            if (!json.success) setError(json.error || "Error al reseed");
            else { setInfo(`Reseed: ${json.inserted ?? "?"} inserted, ${json.skipped ?? "?"} skipped`); await load(); }
        } catch (e: any) { setError(e?.message); }
        finally { setReseeding(false); }
    };

    const runTest = async () => {
        setError(null); setTestResult(null);
        try {
            const url = `/api/admin/pricing-units?test=${encodeURIComponent(testUom)}&qty=${encodeURIComponent(testQty)}`;
            const res = await fetchWithAuthRetry(instance, account, url);
            const json = await res.json();
            if (!json.success) setError(json.error || "Error");
            else setTestResult(json.output || json);
        } catch (e: any) { setError(e?.message); }
    };

    const filtered = units.filter(u =>
        !filter || u.uom_raw.toLowerCase().includes(filter.toLowerCase()) ||
        u.base_unit.toLowerCase().includes(filter.toLowerCase()) ||
        (u.category || "").toLowerCase().includes(filter.toLowerCase())
    );

    return (
        <div className="p-6 space-y-6">
            <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-2"><Database className="w-6 h-6" /> Pricing Unit Normalizer</h1>
                    <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                        Tabla curada de Units of Measure de Azure Billing para normalizar agregados (Hours, GB, Transactions, Tokens, etc.).
                    </p>
                </div>
                <button
                    onClick={reseed}
                    disabled={reseeding}
                    className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded text-sm flex items-center gap-2 disabled:opacity-50"
                >
                    {reseeding ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                    Reseed
                </button>
            </div>

            {error && <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded text-sm">{error}</div>}
            {info && <div className="bg-green-50 border border-green-200 text-green-700 px-3 py-2 rounded text-sm">{info}</div>}

            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
                <h2 className="font-semibold mb-3 flex items-center gap-2"><Play className="w-4 h-4" /> Probar normalización</h2>
                <div className="flex flex-wrap gap-3 items-end">
                    <div>
                        <label className="block text-xs font-medium mb-1">Unit of Measure</label>
                        <input value={testUom} onChange={e => setTestUom(e.target.value)}
                            className="border rounded px-3 py-2 text-sm dark:bg-gray-900 w-56" placeholder="100 Hours" />
                    </div>
                    <div>
                        <label className="block text-xs font-medium mb-1">Quantity</label>
                        <input value={testQty} onChange={e => setTestQty(e.target.value)}
                            className="border rounded px-3 py-2 text-sm dark:bg-gray-900 w-32" />
                    </div>
                    <button onClick={runTest} className="bg-gray-700 hover:bg-gray-800 text-white px-4 py-2 rounded text-sm">
                        Test
                    </button>
                </div>
                {testResult && (
                    <pre className="mt-3 bg-gray-50 dark:bg-gray-900 rounded p-3 text-xs overflow-x-auto">
{JSON.stringify(testResult, null, 2)}
                    </pre>
                )}
            </div>

            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
                <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                    <h2 className="font-semibold">Catálogo ({units.length} UoMs)</h2>
                    <div className="flex items-center gap-2">
                        <Search className="w-4 h-4 text-gray-400" />
                        <input value={filter} onChange={e => setFilter(e.target.value)}
                            placeholder="Filtrar…" className="border rounded px-3 py-1.5 text-sm dark:bg-gray-900 w-56" />
                    </div>
                </div>
                {loading ? (
                    <div className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="w-4 h-4 animate-spin" /> Cargando…</div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead><tr className="border-b text-left text-xs uppercase text-gray-500">
                                <th className="py-2 pr-3">UoM crudo</th>
                                <th className="py-2 pr-3">Block size</th>
                                <th className="py-2 pr-3">Base unit</th>
                                <th className="py-2 pr-3">Display</th>
                                <th className="py-2 pr-3">Categoría</th>
                            </tr></thead>
                            <tbody>
                                {filtered.map(u => (
                                    <tr key={u.uom_raw} className="border-b hover:bg-gray-50 dark:hover:bg-gray-700/50">
                                        <td className="py-2 pr-3 font-mono text-xs">{u.uom_raw}</td>
                                        <td className="py-2 pr-3 font-mono">{u.block_size}</td>
                                        <td className="py-2 pr-3 font-medium">{u.base_unit}</td>
                                        <td className="py-2 pr-3">{u.display_unit}</td>
                                        <td className="py-2 pr-3">
                                            <span className="bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded text-xs">
                                                {u.category}
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                                {filtered.length === 0 && (
                                    <tr><td colSpan={5} className="py-4 text-center text-gray-500 italic">Sin resultados</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}
