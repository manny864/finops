"use client";
import { isMockTenant } from '@/lib/mockData';
import React, { useState, useEffect, useMemo } from 'react';
import { useTenant } from '@/components/TenantProvider';
import { useMsal } from '@azure/msal-react';
import { toast } from 'sonner';
import { FileText, Loader2, Download } from 'lucide-react';
import {

  useReactTable,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  flexRender,
  createColumnHelper,
  SortingState
} from '@tanstack/react-table';

type ActionLog = {
    id: number;
    user_email: string;
    action_type: string;
    resource_id: string;
    status: string;
    timestamp: string;
};

const columnHelper = createColumnHelper<ActionLog>();

export default function AuditTrailPage() {
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();
    const [logs, setLogs] = useState<ActionLog[]>([]);
    const [loading, setLoading] = useState(false);
    const [sorting, setSorting] = useState<SortingState>([{ id: 'timestamp', desc: true }]);

    useEffect(() => {
        if (!selectedTenant || selectedTenant.id === 'default' || (accounts.length === 0 && !isMockTenant(selectedTenant?.id || ''))) return;

        const fetchLogs = async () => {
            setLoading(true);
            try {
                const tokenResponse = await instance.acquireTokenSilent({
                    scopes: ["User.Read"],
                    account: accounts[0]
                });

                const res = await fetch(`/api/admin/audit?tenantId=${selectedTenant.id}`, {
                    headers: { 'Authorization': `Bearer ${tokenResponse.idToken}` }
                });
                
                const json = await res.json();
                if (res.ok && json.logs) {
                    setLogs(json.logs);
                } else {
                    toast.error(json.error || "Error al cargar registros de auditoría");
                }
            } catch (e) {
                console.error("Audit Trail error:", e);
                toast.error("Error al conectar con el servidor.");
            }
            setLoading(false);
        };

        fetchLogs();
    }, [selectedTenant.id, accounts, instance]);

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
        state: { sorting },
        onSortingChange: setSorting,
        getCoreRowModel: getCoreRowModel(),
        getSortedRowModel: getSortedRowModel(),
        getPaginationRowModel: getPaginationRowModel(),
        initialState: {
            pagination: { pageSize: 10 }
        }
    });

    const exportToCsv = () => {
        if (logs.length === 0) return;
        const headers = ['ID', 'Fecha', 'Usuario', 'Acción', 'Recurso', 'Estado'];
        const csvContent = [
            headers.join(','),
            ...logs.map(log => [
                log.id,
                `"${new Date(log.timestamp).toLocaleString()}"`,
                `"${log.user_email}"`,
                `"${log.action_type}"`,
                `"${log.resource_id}"`,
                `"${log.status}"`
            ].join(','))
        ].join('\n');

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.setAttribute("href", url);
        link.setAttribute("download", `audit_trail_${selectedTenant.id}_${new Date().toISOString().split('T')[0]}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

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
            <div className="flex justify-between items-center mb-6">
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-2">
                        <FileText className="text-indigo-600 w-6 h-6" /> Registro de Auditoría
                    </h1>
                    <p className="text-sm text-gray-500 mt-1">Historial de acciones de remediación y cambios en recursos de Azure.</p>
                </div>
                <button 
                    onClick={exportToCsv}
                    disabled={logs.length === 0 || loading}
                    className="flex items-center gap-2 px-4 py-2 bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-lg hover:bg-indigo-100 transition disabled:opacity-50"
                >
                    <Download className="w-4 h-4" /> Exportar CSV
                </button>
            </div>

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
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50">
                                {table.getHeaderGroups().map(headerGroup => (
                                    <tr key={headerGroup.id}>
                                        {headerGroup.headers.map(header => (
                                            <th key={header.id} 
                                                className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                                                onClick={header.column.getToggleSortingHandler()}
                                            >
                                                {flexRender(header.column.columnDef.header, header.getContext())}
                                                {{
                                                  asc: ' 🔼',
                                                  desc: ' 🔽',
                                                }[header.column.getIsSorted() as string] ?? null}
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
                    <div className="flex items-center justify-between mt-4">
                        <div className="text-sm text-gray-500">
                            Página {table.getState().pagination.pageIndex + 1} de {table.getPageCount()}
                        </div>
                        <div className="flex gap-2">
                            <button
                                onClick={() => table.previousPage()}
                                disabled={!table.getCanPreviousPage()}
                                className="px-3 py-1 border rounded text-sm disabled:opacity-50"
                            >
                                Anterior
                            </button>
                            <button
                                onClick={() => table.nextPage()}
                                disabled={!table.getCanNextPage()}
                                className="px-3 py-1 border rounded text-sm disabled:opacity-50"
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
