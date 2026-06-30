"use client";
import React, { useCallback, useEffect, useState } from "react";
import { useTenant } from "@/components/TenantProvider";
import { useMsal } from "@azure/msal-react";
import { getFreshIdToken } from "@/lib/msalToken";
import { KeyRound, Plus, Trash2, Copy, Loader2, ShieldAlert, Check } from "lucide-react";

interface KeyRow {
    id: number; key_prefix: string; label: string;
    created_by_email: string; created_at: string;
    last_used_at: string | null; revoked_at: string | null;
}

export default function MCPKeysPage() {
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();
    const [keys, setKeys] = useState<KeyRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [creating, setCreating] = useState(false);
    const [label, setLabel] = useState("");
    const [newKey, setNewKey] = useState<{ plaintext: string; prefix: string } | null>(null);
    const [copied, setCopied] = useState(false);

    const authHeaders = useCallback(async (): Promise<Record<string, string>> => {
        if (!accounts || accounts.length === 0) return {};
        const token = await getFreshIdToken(instance, accounts[0]);
        return token ? { Authorization: `Bearer ${token}` } : {};
    }, [instance, accounts]);

    const load = useCallback(async () => {
        if (!selectedTenant?.id || selectedTenant.id === "default") { setLoading(false); return; }
        setLoading(true); setError(null);
        try {
            const headers = await authHeaders();
            const res = await fetch(`/api/admin/mcp-keys?tenantId=${selectedTenant.id}`, { headers });
            const json = await res.json();
            if (!json.success) setError(json.error || "Error");
            else setKeys(json.keys || []);
        } catch (e: any) { setError(e?.message); }
        finally { setLoading(false); }
    }, [selectedTenant?.id, authHeaders]);

    useEffect(() => { load(); }, [load]);

    const createKey = async () => {
        if (!label.trim()) { setError("Etiqueta requerida"); return; }
        if (!selectedTenant?.id) return;
        setCreating(true); setError(null); setNewKey(null);
        try {
            const headers = { "Content-Type": "application/json", ...(await authHeaders()) };
            const res = await fetch(`/api/admin/mcp-keys`, {
                method: "POST", headers,
                body: JSON.stringify({ tenantId: selectedTenant.id, label: label.trim() }),
            });
            const json = await res.json();
            if (!json.success) setError(json.error || "Error al crear key");
            else { setNewKey({ plaintext: json.key, prefix: json.prefix }); setLabel(""); await load(); }
        } catch (e: any) { setError(e?.message); }
        finally { setCreating(false); }
    };

    const revoke = async (id: number) => {
        if (!confirm("¿Revocar este key? Las integraciones que lo usen dejarán de funcionar.")) return;
        try {
            const headers = await authHeaders();
            await fetch(`/api/admin/mcp-keys?tenantId=${selectedTenant.id}&keyId=${id}`, { method: "DELETE", headers });
            await load();
        } catch (e: any) { setError(e?.message); }
    };

    const copyKey = () => {
        if (!newKey) return;
        navigator.clipboard.writeText(newKey.plaintext);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className="p-6 space-y-6">
            <div>
                <h1 className="text-2xl font-bold flex items-center gap-2"><KeyRound className="w-6 h-6" /> MCP API Keys</h1>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1 text-justify">
                    Keys de acceso al bridge MCP (<code>/api/mcp</code>) y al feed Power BI. Permite que agentes IA (Claude Desktop, Copilot, GPTs) o Power BI consulten datos del tenant en modo solo-lectura.
                </p>
            </div>

            {error && <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded text-sm">{error}</div>}

            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
                <h2 className="font-semibold mb-3">Crear nuevo key</h2>
                <div className="flex flex-wrap gap-3 items-end">
                    <div className="flex-1 min-w-[200px]">
                        <label className="block text-xs font-medium mb-1">Etiqueta (ej: "Claude Desktop Juan")</label>
                        <input value={label} onChange={e => setLabel(e.target.value)}
                            className="w-full border rounded px-3 py-2 text-sm dark:bg-gray-900" placeholder="Etiqueta descriptiva" />
                    </div>
                    <button onClick={createKey} disabled={creating || !label.trim()}
                        className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded text-sm flex items-center gap-2 disabled:opacity-50">
                        {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                        Crear key
                    </button>
                </div>

                {newKey && (
                    <div className="mt-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-300 rounded p-3">
                        <div className="flex items-start gap-2 text-amber-700 dark:text-amber-300 mb-2">
                            <ShieldAlert className="w-5 h-5 mt-0.5" />
                            <div>
                                <p className="font-semibold">Guarda este key ahora.</p>
                                <p className="text-xs">No se puede recuperar después. Solo se almacena el hash.</p>
                            </div>
                        </div>
                        <div className="flex items-center gap-2 bg-white dark:bg-gray-900 rounded px-3 py-2">
                            <code className="font-mono text-xs flex-1 break-all">{newKey.plaintext}</code>
                            <button onClick={copyKey} className="text-blue-600 hover:text-blue-700 flex items-center gap-1 text-xs">
                                {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                                {copied ? "Copiado" : "Copiar"}
                            </button>
                        </div>
                    </div>
                )}
            </div>

            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
                <h2 className="font-semibold mb-3">Keys existentes ({keys.length})</h2>
                {loading ? (
                    <div className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="w-4 h-4 animate-spin" /> Cargando…</div>
                ) : keys.length === 0 ? (
                    <p className="text-sm text-gray-500 italic">Sin keys. Crea uno arriba.</p>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead><tr className="border-b text-left text-xs uppercase text-gray-500">
                                <th className="py-2 pr-3">Prefix</th>
                                <th className="py-2 pr-3">Etiqueta</th>
                                <th className="py-2 pr-3">Creada por</th>
                                <th className="py-2 pr-3">Creada</th>
                                <th className="py-2 pr-3">Último uso</th>
                                <th className="py-2 pr-3">Estado</th>
                                <th className="py-2"></th>
                            </tr></thead>
                            <tbody>
                                {keys.map(k => (
                                    <tr key={k.id} className="border-b">
                                        <td className="py-2 pr-3 font-mono text-xs">{k.key_prefix}…</td>
                                        <td className="py-2 pr-3 font-medium">{k.label}</td>
                                        <td className="py-2 pr-3 text-xs">{k.created_by_email}</td>
                                        <td className="py-2 pr-3 text-xs">{new Date(k.created_at).toLocaleDateString()}</td>
                                        <td className="py-2 pr-3 text-xs">{k.last_used_at ? new Date(k.last_used_at).toLocaleString() : "Nunca"}</td>
                                        <td className="py-2 pr-3">
                                            {k.revoked_at
                                                ? <span className="bg-red-100 text-red-700 px-2 py-0.5 rounded text-xs">Revocada</span>
                                                : <span className="bg-green-100 text-green-700 px-2 py-0.5 rounded text-xs">Activa</span>}
                                        </td>
                                        <td className="py-2">
                                            {!k.revoked_at && (
                                                <button onClick={() => revoke(k.id)} className="text-red-600 hover:text-red-700">
                                                    <Trash2 className="w-4 h-4" />
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 rounded-lg p-4 text-sm">
                <p className="font-semibold mb-2">¿Cómo usar?</p>
                <ul className="list-disc ml-5 space-y-1 text-xs">
                    <li><code>GET /api/mcp</code> — descubrir capabilities (público).</li>
                    <li><code>POST /api/mcp</code> con <code>Authorization: Bearer mcp_…</code> — JSON-RPC con <code>tools/list</code> o <code>tools/call</code>.</li>
                    <li><code>GET /api/exports/powerbi-feed?type=costs</code> — feed Power BI con el mismo key.</li>
                </ul>
            </div>
        </div>
    );
}
