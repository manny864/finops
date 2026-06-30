"use client";
import MockBanner from '@/components/MockBanner';
import { isMockTenant } from '@/lib/mockData';
import React, { useState, useEffect, useMemo } from 'react';
import { useTenant } from '@/components/TenantProvider';
import { useMsal } from '@azure/msal-react';
import { toast } from 'sonner';
import { FileText, Loader2, Download, X } from 'lucide-react';
import { getFreshIdToken } from '@/lib/msalToken';
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  createColumnHelper,
} from '@tanstack/react-table';

type ActionLog = {
    id: number;
    user_email: string;
    action_type: string;
    resource_id: string;
    status: string;
    timestamp: string;
};

type ApiResponse = {
    logs: ActionLog[];
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
    error?: string;
};

const columnHelper = createColumnHelper<ActionLog>();

export default function AuditTrailPage() {
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();
    const [logs, setLogs] = useState<ActionLog[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(false);
    const [exporting, setExporting] = useState(false);
    
    // Filters
    const [userEmail, setUserEmail] = useState("");
    const [actionType, setActionType] = useState("");
    const [status, setStatus] = useState("");
    const [fromDate, setFromDate] = useState("");
    const [toDate, setToDate] = useState("");
    const [actionTypes, setActionTypes] = useState<string[]>([]);
    
    // Pagination
    const [pageIndex, setPageIndex] = useState(0);
    const [pageSize] = useState(10);

    const fetchActionTypes = async (token: string) => {
        try {
            const res = await fetch(`/api/admin/audit?tenantId=${selectedTenant.id}&limit=1`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
                // This would need another endpoint to get distinct action types
                // For now, we'll populate from logs we fetch
                setActionTypes(['CREATE', 'UPDATE', 'DELETE', 'READ', 'EXPORT']);
            }
        } catch (e) {
            console.error("Error fetching action types:", e);
        }
    };

    const fetchLogs = async (reset = false) => {
        if (!selectedTenant || selectedTenant.id === 'default' || (accounts.length === 0 && !isMockTenant(selectedTenant?.id || ''))) return;

        const actualPageIndex = reset ? 0 : pageIndex;
        if (reset) setPageIndex(0);

        setLoading(true);
        try {
            const tokenResponse = { idToken: await getFreshIdToken(instance, accounts[0]) };
            
            const params = new URLSearchParams({
                tenantId: selectedTenant.id,
                limit: pageSize.toString(),
                offset: (actualPageIndex * pageSize).toString(),
                format: 'json'
            });

            if (userEmail) params.append('user_email', userEmail);
            if (actionType) params.append('action_type', actionType);
            if (status) params.append('status', status);
            if (fromDate) params.append('from', fromDate);
            if (toDate) params.append('to', toDate);

            const res = await fetch(`/api/admin/audit?${params}`, {
                headers: { 'Authorization': `Bearer ${tokenResponse.idToken}` }
            });
            
            const json = (await res.json()) as ApiResponse;
            if (res.ok && json.logs) {
                setLogs(json.logs);
                setTotal(json.total);
            } else {
                toast.error(json.error || "Error al cargar registros de auditoría");
                setLogs([]);
                setTotal(0);
            }
        } catch (e) {
            console.error("Audit Trail error:", e);
            toast.error("Error al conectar con el servidor.");
            setLogs([]);
            setTotal(0);
        }
        setLoading(false);
    };

    useEffect(() => {
        if (!selectedTenant || selectedTenant.id === 'default') return;
        fetchLogs(false);
    }, [selectedTenant?.id, accounts, instance, pageIndex]);

    useEffect(() => {
        if (!selectedTenant || selectedTenant.id === 'default') return;
        if (accounts.length === 0 && !isMockTenant(selectedTenant?.id || '')) return;
        
        const tokenize = async () => {
            const tokenResponse = { idToken: await getFreshIdToken(instance, accounts[0]) };
            fetchActionTypes(tokenResponse.idToken);
        };
        tokenize().catch(console.error);
    }, [selectedTenant?.id, accounts, instance]);

    const handleApplyFilters = () => {
        fetchLogs(true);
    };

    const handleClearFilters = () => {
        setUserEmail("");
        setActionType("");
        setStatus("");
        setFromDate("");
        setToDate("");
        setPageIndex(0);
        setLogs([]);
        setTotal(0);
    };

    const handleExport = async (format: "csv" | "json" | "ndjson", isFull: boolean = false) => {
        if (!selectedTenant || selectedTenant.id === 'default') {
            toast.error("Selecciona un tenant primero");
            return;
        }

        setExporting(true);
        try {
            const tokenResponse = { idToken: await getFreshIdToken(instance, accounts[0]) };
            
            const params = new URLSearchParams({
                tenantId: selectedTenant.id,
                format,
            });

            if (userEmail) params.append('user_email', userEmail);
            if (actionType) params.append('action_type', actionType);
            if (status) params.append('status', status);
            if (fromDate) params.append('from', fromDate);
            if (toDate) params.append('to', toDate);

            const endpoint = isFull ? '/api/admin/audit/export' : '/api/admin/audit';
            const res = await fetch(`${endpoint}?${params}`, {
                headers: { 'Authorization': `Bearer ${tokenResponse.idToken}` }
            });

            if (!res.ok) {
                const errorData = await res.json();
                toast.error(errorData.error || "Error al exportar");
                return;
            }

            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            
            const date = new Date().toISOString().split('T')[0];
            const fullSuffix = isFull ? '-full' : '';
            const filename = `audit-${selectedTenant.id}${fullSuffix}-${date}.${format === 'json' ? 'json' : format === 'ndjson' ? 'ndjson' : 'csv'}`;
            
            link.setAttribute("href", url);
            link.setAttribute("download", filename);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            
            toast.success(`Exportación completada: ${filename}`);
        } catch (e) {
            console.error("Export error:", e);
            toast.error("Error al exportar registros");
        }
        setExporting(false);
    };

    const columns = useMemo(() => [
        columnHelper.accessor('timestamp', {
            header: 'Fecha',
            cell: info => new Date(info.getValue()).toLocaleString(),
        }),
        columnHelper.accessor('user_email', {
            header: 'Usuario (Email)',
        }),
        columnHelper.accessor('action_type', {
            header: 'Acción',
        }),
        columnHelper.accessor('resource_id', {
            header: 'Recurso',
            cell: info => {
                const val = info.getValue();
                const parts = val.split('/');
                return parts[parts.length - 1] || val;
            }
        }),
        columnHelper.accessor('status', {
            header: 'Estado',
            cell: info => {
                const val = info.getValue();
                return (
                    <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                        val === 'SUCCESS' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                    }`}>
                        {val}
                    </span>
                )
            }
        })
    ], []);

    const table = useReactTable({
        data: logs,
        columns,
        getCoreRowModel: getCoreRowModel(),
    });

    const pageCount = Math.ceil(total / pageSize);
    const startRow = pageIndex * pageSize + 1;
    const endRow = Math.min((pageIndex + 1) * pageSize, total);

    if (selectedTenant.id === 'default') {
        return (
            <div className="flex flex-col items-center justify-center h-96 bg-white dark:bg-slate-900 rounded-lg border border-gray-200 shadow-sm">
                <span className="text-4xl mb-4">🔐</span>
                <h2 className="text-xl font-bold text-gray-700">Selecciona un Tenant</h2>
                <p className="text-sm text-gray-500 mt-2">Debes seleccionar un cliente para ver su auditoría.</p>
            </div>
        );
    }

    return (
        <div className="max-w-7xl mx-auto animate-in fade-in duration-500 p-6 bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200">
            <MockBanner />
            
            {/* Header */}
            <div className="mb-6">
                <h1 className="text-2xl font-bold flex items-center gap-2">
                    <FileText className="text-indigo-600 w-6 h-6" /> Registro de Auditoría
                </h1>
                <p className="text-sm text-gray-500 mt-1">Historial de acciones de remediación y cambios en recursos de Azure.</p>
            </div>

            {/* Filters */}
            <div className="mb-6 p-4 bg-gray-50 rounded-lg border border-gray-200">
                <h3 className="text-sm font-semibold text-gray-700 mb-4">Filtros</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
                    <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">Email de Usuario</label>
                        <input
                            type="text"
                            value={userEmail}
                            onChange={(e) => setUserEmail(e.target.value)}
                            placeholder="ej: user@example.com"
                            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">Tipo de Acción</label>
                        <select
                            value={actionType}
                            onChange={(e) => setActionType(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        >
                            <option value="">Todas</option>
                            {actionTypes.map(type => (
                                <option key={type} value={type}>{type}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">Estado</label>
                        <select
                            value={status}
                            onChange={(e) => setStatus(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        >
                            <option value="">Todos</option>
                            <option value="SUCCESS">SUCCESS</option>
                            <option value="FAILURE">FAILURE</option>
                        </select>
                    </div>
                    <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">Desde</label>
                        <input
                            type="date"
                            value={fromDate}
                            onChange={(e) => setFromDate(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">Hasta</label>
                        <input
                            type="date"
                            value={toDate}
                            onChange={(e) => setToDate(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                    </div>
                </div>

                {/* Buttons */}
                <div className="flex flex-wrap gap-2">
                    <button
                        onClick={handleApplyFilters}
                        disabled={loading}
                        className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition"
                    >
                        Aplicar filtros
                    </button>
                    <button
                        onClick={handleClearFilters}
                        className="px-4 py-2 bg-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-400 transition"
                    >
                        Limpiar
                    </button>
                </div>
            </div>

            {/* Export Buttons */}
            <div className="mb-6 p-4 bg-blue-50 rounded-lg border border-blue-200">
                <h3 className="text-sm font-semibold text-gray-700 mb-3">Exportar</h3>
                <div className="flex flex-wrap gap-2">
                    <button
                        onClick={() => handleExport("csv", false)}
                        disabled={logs.length === 0 || loading || exporting}
                        className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition"
                    >
                        <Download className="w-4 h-4" /> CSV (página actual)
                    </button>
                    <button
                        onClick={() => handleExport("csv", true)}
                        disabled={loading || exporting}
                        className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition"
                    >
                        <Download className="w-4 h-4" /> CSV (filtrado completo)
                    </button>
                    <button
                        onClick={() => handleExport("json", false)}
                        disabled={logs.length === 0 || loading || exporting}
                        className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50 transition"
                    >
                        <Download className="w-4 h-4" /> JSON
                    </button>
                    <button
                        onClick={() => handleExport("ndjson", false)}
                        disabled={logs.length === 0 || loading || exporting}
                        className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white text-sm font-medium rounded-lg hover:bg-purple-700 disabled:opacity-50 transition"
                    >
                        <Download className="w-4 h-4" /> NDJSON
                    </button>
                </div>
            </div>

            {/* Table */}
            {loading ? (
                <div className="flex flex-col items-center justify-center h-64 text-gray-400">
                    <Loader2 className="w-8 h-8 animate-spin mb-4 text-indigo-500" />
                    Cargando registros...
                </div>
            ) : logs.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-64 border-2 border-dashed border-gray-300 rounded-lg text-gray-500">
                    <FileText className="w-12 h-12 mb-2 text-gray-300" />
                    No hay acciones registradas para este tenant.
                </div>
            ) : (
                <>
                    <div className="overflow-x-auto mb-4">
                        <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50">
                                {table.getHeaderGroups().map(headerGroup => (
                                    <tr key={headerGroup.id}>
                                        {headerGroup.headers.map(header => (
                                            <th key={header.id} 
                                                className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                                            >
                                                {flexRender(header.column.columnDef.header, header.getContext())}
                                            </th>
                                        ))}
                                    </tr>
                                ))}
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                                {table.getRowModel().rows.map(row => (
                                    <tr key={row.id} className="hover:bg-gray-50 transition-colors">
                                        {row.getVisibleCells().map(cell => (
                                            <td key={cell.id} className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                                {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                            </td>
                                        ))}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    {/* Pagination */}
                    <div className="flex items-center justify-between border-t pt-4">
                        <div className="text-sm text-gray-600">
                            {total > 0 && `${startRow}-${endRow} de ${total} resultados`}
                        </div>
                        <div className="flex gap-2">
                            <button
                                onClick={() => setPageIndex(p => Math.max(0, p - 1))}
                                disabled={pageIndex === 0 || loading}
                                className="px-3 py-1 border rounded text-sm disabled:opacity-50 hover:bg-gray-50"
                            >
                                Anterior
                            </button>
                            <span className="px-3 py-1 text-sm text-gray-600">
                                Página {pageIndex + 1} de {pageCount || 1}
                            </span>
                            <button
                                onClick={() => setPageIndex(p => (p + 1 < pageCount ? p + 1 : p))}
                                disabled={pageIndex + 1 >= pageCount || loading}
                                className="px-3 py-1 border rounded text-sm disabled:opacity-50 hover:bg-gray-50"
                            >
                                Siguiente
                            </button>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}
