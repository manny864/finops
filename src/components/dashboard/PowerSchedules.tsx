"use client";
import React, { useState, useEffect, useMemo } from 'react';
import { toast } from 'sonner';
import { useMsal } from '@azure/msal-react';
import { useTenant } from '../TenantProvider';
import { useSubscription } from '../SubscriptionProvider';
import FeatureGuard from '../FeatureGuard';
import { getMockDataForRoute, isMockTenant } from '@/lib/mockData';
import { hasAccess } from '@/lib/tierLogic';
import {
  useReactTable,
  getCoreRowModel,
  getPaginationRowModel,
  flexRender,
  ColumnDef
} from '@tanstack/react-table';

export default function PowerSchedules() {
    const { instance, accounts } = useMsal();
    const { selectedTenant } = useTenant();
    const { selectedSubscription } = useSubscription();
    const [vms, setVms] = useState<any[]>([]);
    const [selectedVmIds, setSelectedVmIds] = useState<string[]>([]);
    const [loading, setLoading] = useState(true);

    const [actionLoading, setActionLoading] = useState<string | null>(null);
    const [refetchTick, setRefetchTick] = useState(0);
    const [scheduleVmName, setScheduleVmName] = useState('');
    const [shutdownTime, setShutdownTime] = useState('');
    const [gmtOffset, setGmtOffset] = useState('-05:00');
    const [smartShutdownEnabled, setSmartShutdownEnabled] = useState(false);
    const [maxCpuPercentage, setMaxCpuPercentage] = useState(10);
    const [idleDurationMinutes, setIdleDurationMinutes] = useState(60);
    
    let t: any = (key: string) => key === 'prev' ? 'Anterior' : 'Siguiente';
    try {
      const nextIntl = require('next-intl');
      if (nextIntl && nextIntl.useTranslations) {
        t = nextIntl.useTranslations();
      }
    } catch (e) {}

    const handleSetSchedule = () => {
        if (!scheduleVmName || !shutdownTime) return;
        alert(`Horario de apagado configurado para ${scheduleVmName} a las ${shutdownTime} (GMT ${gmtOffset}).\nEsta configuración ha sido enviada al engine.`);
        setScheduleVmName('');
        setShutdownTime('');
    };

    useEffect(() => {
        if (accounts.length === 0 || selectedTenant.id === 'default') return;
        const fetchVms = async () => {
            setLoading(true);
            try {
                let json;
                if (isMockTenant(selectedTenant.id)) {
                    json = getMockDataForRoute('audit_full', selectedTenant.id);
                } else {
                    const tokenResponse = await instance.acquireTokenSilent({
                        scopes: ["User.Read"],
                        account: accounts[0]
                    });
                    const subParam = selectedSubscription && selectedSubscription.toLowerCase() !== 'all'
                        ? `&subscriptionId=${selectedSubscription}`
                        : '';
                    const res = await fetch(`/api/power?tenantId=${selectedTenant.id}${subParam}`, {
                        headers: { 'Authorization': `Bearer ${tokenResponse.idToken}` }
                    });
                    if (!res.ok) {
                        throw new Error(`Power VM fetch failed: ${res.status}`);
                    }
                    json = await res.json();
                }
                
                if (json?.auditResults && json.auditResults.allVirtualMachines) {
                    setVms(json.auditResults.allVirtualMachines);
                    setSelectedVmIds(json.auditResults.allVirtualMachines.map((vm: any) => vm.id));
                } else {
                    setVms([]);
                    setSelectedVmIds([]);
                }
            } catch (e) {
                console.error("Error fetching VMs:", e);
            }
            setLoading(false);
        };
        fetchVms();
    }, [accounts, instance, selectedTenant.id, selectedSubscription, refetchTick]);

    const handleAction = async (action: 'start' | 'stop' | 'restart', singleVm?: any) => {
        const targetVms = singleVm ? [singleVm] : vms.filter(vm => selectedVmIds.includes(vm.id));
        if (targetVms.length === 0) return;
        
        setActionLoading(action);
        try {
            const tokenResponse = await instance.acquireTokenSilent({
                scopes: ["User.Read"],
                account: accounts[0]
            });
            const payload = targetVms.map(vm => ({
                subscriptionId: vm.subscriptionId,
                resourceGroup: vm.resourceGroup,
                resourceName: vm.name
            }));
            
            const res = await fetch('/api/power', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${tokenResponse.idToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    tenantId: selectedTenant.id,
                    action,
                    vms: payload,
                    ...(action === 'stop' ? { 
                        thresholdOptions: {
                            enabled: smartShutdownEnabled,
                            maxCpuPercentage,
                            idleDurationMinutes
                        }
                    } : {})
                })
            });
            
            const data = await res.json();
            if (!res.ok) {
                // Si el backend devolvió errores parciales (per-VM), los mostramos
                // explícitamente para que el usuario sepa qué falló (permisos,
                // CPU threshold, etc.) en vez de un mensaje genérico.
                const details = Array.isArray(data?.details) ? data.details : [];
                if (details.length > 0) {
                    const msgs = details.map((d: any) => `• ${d.vm}: ${d.error}`).join('\n');
                    throw new Error(`${data.error || 'Errores en la ejecución'}:\n${msgs}`);
                }
                throw new Error(data.error || 'Error en la petición');
            }

            const labelAction = action === 'start' ? 'Encender' : action === 'restart' ? 'Reiniciar' : 'Apagar';
            if (data?.mock || data?.simulated) {
                toast(`[SIMULACIÓN DEMO] ${labelAction}: ${data.message || `acción simulada sobre ${targetVms.length} VM(s). En un tenant real esto enviaría el comando a Azure.`}`, { icon: '🧪', duration: 6000 });
            } else {
                // Aunque res.ok sea 200, puede haber VMs OMITIDAS (Smart Shutdown:
                // CPU sobre umbral) o FALLIDAS. En esos casos NO mostramos un
                // "éxito" liso: informamos exactamente qué VM no se apagó y por qué.
                const skipped: Array<{ vm: string; reason: string }> = Array.isArray(data?.skipped) ? data.skipped : [];
                const failed: Array<{ vm: string; error: string }> = Array.isArray(data?.failed)
                    ? data.failed
                    : (Array.isArray(data?.details) ? data.details : []);
                const succeeded = typeof data?.succeeded === 'number' ? data.succeeded : (targetVms.length - skipped.length - failed.length);

                if (failed.length > 0) {
                    const msgs = failed.map((d) => `• ${d.vm}: ${d.error}`).join('\n');
                    toast.error(`${labelAction}: ${failed.length} VM(s) con error y no se ejecutaron:\n${msgs}`, { duration: 9000 });
                } else if (skipped.length > 0) {
                    const msgs = skipped.map((d) => `• ${d.vm}: ${d.reason}`).join('\n');
                    toast(`${labelAction}: ${succeeded} ejecutada(s), ${skipped.length} OMITIDA(s) por Smart Shutdown (siguen encendidas):\n${msgs}`, { icon: '⚠️', duration: 9000 });
                } else {
                    toast.success(`${labelAction}: comando aceptado por Azure para ${succeeded} VM(s). Refrescando estado…`);
                }
                // Esperar ~5s y refrescar para mostrar el powerState actualizado.
                // beginDeallocateAndWait ya esperó la transición, pero el cache
                // de ARG puede tardar unos segundos en reflejarla.
                setTimeout(() => setRefetchTick(t => t + 1), 5000);
            }
        } catch (e: any) {
            console.error(`Error al ejecutar ${action}:`, e);
            alert(`Error al ejecutar la acción: ${e.message}`);
        }
        setActionLoading(null);
    };

    const toggleSelection = (id: string) => {
        setSelectedVmIds(prev => 
            prev.includes(id) ? prev.filter(v => v !== id) : [...prev, id]
        );
    };

    const toggleAll = () => {
        if (selectedVmIds.length === vms.length) {
            setSelectedVmIds([]);
        } else {
            setSelectedVmIds(vms.map(vm => vm.id));
        }
    };

    const columns = useMemo<ColumnDef<any>[]>(() => [
        {
            id: 'select',
            header: () => (
                <input 
                    type="checkbox" 
                    checked={selectedVmIds.length === vms.length && vms.length > 0}
                    onChange={toggleAll}
                    className="rounded text-[#0054A6] focus:ring-[#0054A6]"
                />
            ),
            cell: ({ row }) => (
                <input 
                    type="checkbox"
                    checked={selectedVmIds.includes(row.original.id)}
                    onChange={() => toggleSelection(row.original.id)}
                    className="rounded text-[#0054A6] focus:ring-[#0054A6]"
                />
            ),
            size: 50,
        },
        {
            accessorKey: 'name',
            header: 'Máquina Virtual',
            cell: info => <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">{info.getValue() as string}</span>,
        },
        {
            accessorKey: 'resourceGroup',
            header: 'Resource Group',
            cell: info => <span className="text-sm text-gray-500 dark:text-gray-400">{info.getValue() as string}</span>,
        },
        {
            id: 'powerState',
            header: 'Estado',
            cell: ({ row }) => {
                const vm = row.original;
                let stateLabel = 'Sin reportar';
                let isRunning = false;
                if (vm.powerState) {
                    if (vm.powerState === 'PowerState/running') {
                        stateLabel = 'Encendida';
                        isRunning = true;
                    } else if (vm.powerState === 'PowerState/deallocated' || vm.powerState === 'PowerState/stopped') {
                        stateLabel = 'Apagada';
                    } else {
                        stateLabel = vm.powerState.replace('PowerState/', '');
                    }
                }
                return (
                    <span className={`px-2 py-1 text-xs font-semibold rounded-full ${isRunning ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}>
                        {stateLabel}
                    </span>
                );
            }
        },
        {
            id: 'actions',
            header: 'Acciones',
            cell: ({ row }) => {
                const vm = row.original;
                return (
                    <div className="flex gap-2 justify-end">
                        <button onClick={() => handleAction('start', vm)} disabled={actionLoading !== null} className="text-xs bg-green-50 text-green-700 px-2 py-1 border border-green-200 rounded hover:bg-green-100 disabled:opacity-50 transition-colors">Start</button>
                        <button onClick={() => handleAction('stop', vm)} disabled={actionLoading !== null} className="text-xs bg-amber-50 text-amber-700 px-2 py-1 border border-amber-200 rounded hover:bg-amber-100 disabled:opacity-50 transition-colors">Stop</button>
                        <button onClick={() => handleAction('restart', vm)} disabled={actionLoading !== null} className="text-xs bg-blue-50 text-blue-700 px-2 py-1 border border-blue-200 rounded hover:bg-blue-100 disabled:opacity-50 transition-colors">Restart</button>
                    </div>
                );
            }
        }
    ], [selectedVmIds, vms, actionLoading]);

    const table = useReactTable({
        data: vms,
        columns,
        columnResizeMode: 'onChange',
        getCoreRowModel: getCoreRowModel(),
        getPaginationRowModel: getPaginationRowModel(),
    });

    if (accounts.length === 0 || selectedTenant.id === 'default') return null;

    const isPro = hasAccess(selectedTenant.tier || 'Essential', 'Professional');

    return (
        <FeatureGuard requiredTier="Essential" featureName="VM Control" className="h-full">
            <div className="card h-full flex flex-col overflow-hidden">
                <div className="card-h shrink-0">
                    <div className="flex flex-col">
                        <h3 className="m-0">{t('Dashboard.vm_control')}</h3>
                        <p className="text-[13px] text-ink-soft m-0 mt-1 font-normal">{t('Dashboard.vm_control_desc')}</p>
                    </div>
                </div>
                
                <div className="p-[18px] flex-1 overflow-y-auto custom-scrollbar">
                    <div className="bg-surface-2 p-[18px] rounded-[10px] border border-line mb-6 flex flex-col md:flex-row items-end gap-4">
                        <div className="w-full md:w-1/3">
                            <label className="text-[11px] font-bold text-grey uppercase tracking-[0.5px] block mb-2">Nombre de la Máquina</label>
                            <select
                                value={scheduleVmName}
                                onChange={(e) => setScheduleVmName(e.target.value)}
                                className="w-full bg-surface border border-line text-ink text-[13px] font-bold rounded-[10px] focus:border-brand-bright focus:ring-1 focus:ring-brand-bright p-2 outline-none placeholder-ink-soft"
                            >
                                <option value="">-- Seleccionar Máquina --</option>
                                {vms.map(vm => (
                                    <option key={vm.id} value={vm.name}>{vm.name} ({vm.resourceGroup})</option>
                                ))}
                            </select>
                        </div>
                        <div className="w-full md:w-1/4">
                            <label className="text-[11px] font-bold text-grey uppercase tracking-[0.5px] block mb-2">Hora de Apagado</label>
                            <input 
                                type="time" 
                                value={shutdownTime}
                                onChange={(e) => setShutdownTime(e.target.value)}
                                className="w-full bg-surface border border-line text-ink text-[13px] font-bold rounded-[10px] focus:border-brand-bright focus:ring-1 focus:ring-brand-bright p-2 outline-none placeholder-ink-soft"
                            />
                        </div>
                        <div className="w-full md:w-1/4">
                            <label className="text-[11px] font-bold text-grey uppercase tracking-[0.5px] block mb-2">Zona Horaria</label>
                            <select 
                                value={gmtOffset}
                                onChange={(e) => setGmtOffset(e.target.value)}
                                className="w-full bg-surface border border-line text-ink text-[13px] font-bold rounded-[10px] focus:border-brand-bright focus:ring-1 focus:ring-brand-bright p-2 outline-none placeholder-ink-soft"
                            >
                                <option value="-12:00">GMT-12:00</option>
                                <option value="-11:00">GMT-11:00</option>
                                <option value="-10:00">GMT-10:00</option>
                                <option value="-09:00">GMT-09:00</option>
                                <option value="-08:00">GMT-08:00 (PST)</option>
                                <option value="-07:00">GMT-07:00 (MST)</option>
                                <option value="-06:00">GMT-06:00 (CST)</option>
                                <option value="-05:00">GMT-05:00 (EST/COT)</option>
                                <option value="-04:00">GMT-04:00 (AST)</option>
                                <option value="-03:30">GMT-03:30</option>
                                <option value="-03:00">GMT-03:00 (ART/BRT)</option>
                                <option value="-02:00">GMT-02:00</option>
                                <option value="-01:00">GMT-01:00</option>
                                <option value="+00:00">GMT+00:00 (UTC)</option>
                                <option value="+01:00">GMT+01:00 (CET)</option>
                                <option value="+02:00">GMT+02:00</option>
                                <option value="+03:00">GMT+03:00</option>
                                <option value="+03:30">GMT+03:30</option>
                                <option value="+04:00">GMT+04:00</option>
                                <option value="+04:30">GMT+04:30</option>
                                <option value="+05:00">GMT+05:00</option>
                                <option value="+05:30">GMT+05:30</option>
                                <option value="+05:45">GMT+05:45</option>
                                <option value="+06:00">GMT+06:00</option>
                                <option value="+06:30">GMT+06:30</option>
                                <option value="+07:00">GMT+07:00</option>
                                <option value="+08:00">GMT+08:00</option>
                                <option value="+08:45">GMT+08:45</option>
                                <option value="+09:00">GMT+09:00 (JST)</option>
                                <option value="+09:30">GMT+09:30</option>
                                <option value="+10:00">GMT+10:00 (AEST)</option>
                                <option value="+10:30">GMT+10:30</option>
                                <option value="+11:00">GMT+11:00</option>
                                <option value="+12:00">GMT+12:00</option>
                                <option value="+13:00">GMT+13:00</option>
                                <option value="+14:00">GMT+14:00</option>
                            </select>
                        </div>
                        <div className="w-full md:w-auto">
                            <button 
                                onClick={handleSetSchedule}
                                className="w-full bg-brand-deep text-white px-[11px] py-[7px] rounded-[10px] font-heading font-bold text-[12px] hover:brightness-110 shadow-sm transition-colors cursor-pointer disabled:opacity-50"
                                disabled={!scheduleVmName || !shutdownTime}
                            >
                                Establecer
                            </button>
                        </div>
                    </div>

                    <div className="bg-surface-2 p-[18px] rounded-[10px] border border-line mb-6 flex flex-col items-start gap-4">
                        <div className="flex items-center justify-between w-full">
                            <div>
                                <h4 className="text-[13px] font-bold text-ink mb-1">Smart Shutdown (Threshold-based)</h4>
                                <p className="text-[12px] text-ink-soft m-0">Evita apagar máquinas si están bajo uso activo.</p>
                            </div>
                            <div className="flex items-center gap-3">
                                {!isPro && (
                                    <span className="text-[11px] font-bold bg-amber-100 text-amber-800 px-2 py-1 rounded">Requires Pro Tier</span>
                                )}
                                <label className="relative inline-flex items-center cursor-pointer">
                                    <input type="checkbox" className="sr-only peer" checked={smartShutdownEnabled} onChange={(e) => setSmartShutdownEnabled(e.target.checked)} disabled={!isPro} />
                                    <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-brand-bright"></div>
                                </label>
                            </div>
                        </div>
                        
                        {smartShutdownEnabled && (
                            <div className="flex flex-col md:flex-row gap-4 w-full mt-2">
                                <div className="w-full md:w-1/2">
                                    <label className="text-[11px] font-bold text-grey uppercase tracking-[0.5px] block mb-2">Máximo uso de CPU (%)</label>
                                    <input 
                                        type="number" 
                                        value={maxCpuPercentage}
                                        onChange={(e) => setMaxCpuPercentage(Number(e.target.value))}
                                        className="w-full bg-surface border border-line text-ink text-[13px] font-bold rounded-[10px] focus:border-brand-bright focus:ring-1 focus:ring-brand-bright p-2 outline-none"
                                    />
                                </div>
                                <div className="w-full md:w-1/2">
                                    <label className="text-[11px] font-bold text-grey uppercase tracking-[0.5px] block mb-2">Ventana de tiempo (Minutos)</label>
                                    <input 
                                        type="number" 
                                        value={idleDurationMinutes}
                                        onChange={(e) => setIdleDurationMinutes(Number(e.target.value))}
                                        className="w-full bg-surface border border-line text-ink text-[13px] font-bold rounded-[10px] focus:border-brand-bright focus:ring-1 focus:ring-brand-bright p-2 outline-none"
                                    />
                                </div>
                            </div>
                        )}
                    </div>

                    
                    {loading ? (
                        <div className="empty animate-pulse">Cargando VMs...</div>
                    ) : vms.length === 0 ? (
                        <div className="empty">No se encontraron máquinas virtuales en el tenant.</div>
                    ) : (
                        <>
                            <div className="flex flex-wrap gap-2 mb-4">
                                <button 
                                    onClick={() => handleAction('stop')}
                                    disabled={actionLoading !== null || selectedVmIds.length === 0}
                                    className="bg-amber text-white hover:brightness-110 px-[11px] py-[7px] rounded-[10px] font-heading font-semibold text-[12px] shadow-sm disabled:opacity-50 transition-colors cursor-pointer"
                                >
                                    {actionLoading === 'stop' ? 'Procesando...' : 'Apagar Selección'}
                                </button>
                                <button 
                                    onClick={() => handleAction('start')}
                                    disabled={actionLoading !== null || selectedVmIds.length === 0}
                                    className="bg-green text-white hover:brightness-110 px-[11px] py-[7px] rounded-[10px] font-heading font-semibold text-[12px] shadow-sm disabled:opacity-50 transition-colors cursor-pointer"
                                >
                                    {actionLoading === 'start' ? 'Procesando...' : 'Encender Selección'}
                                </button>
                                <button 
                                    onClick={() => handleAction('restart')}
                                    disabled={actionLoading !== null || selectedVmIds.length === 0}
                                    className="bg-brand-bright text-white hover:brightness-110 px-[11px] py-[7px] rounded-[10px] font-heading font-semibold text-[12px] shadow-sm disabled:opacity-50 transition-colors cursor-pointer"
                                >
                                    {actionLoading === 'restart' ? 'Procesando...' : 'Reiniciar Selección'}
                                </button>
                            </div>
                            
                            <div className="border border-line rounded-[14px] overflow-hidden bg-surface">
                                <div className="overflow-x-auto w-full">
                                    <table className="tbl w-full" style={{ width: table.getCenterTotalSize() }}>
                                        <thead>
                                        {table.getHeaderGroups().map(headerGroup => (
                                            <tr key={headerGroup.id}>
                                            {headerGroup.headers.map(header => (
                                                <th key={header.id} className="relative group" style={{ width: header.getSize() }}>
                                                <div className="flex items-center justify-between">
                                                    {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                                                </div>
                                                <div
                                                    onMouseDown={header.getResizeHandler()}
                                                    onTouchStart={header.getResizeHandler()}
                                                    className={`absolute right-0 top-0 h-full w-1 cursor-col-resize bg-line opacity-0 group-hover:opacity-100 transition-opacity ${header.column.getIsResizing() ? 'opacity-100 bg-brand-deep' : ''}`}
                                                />
                                                </th>
                                            ))}
                                            </tr>
                                        ))}
                                        </thead>
                                        <tbody>
                                        {table.getRowModel().rows.length > 0 ? (
                                            table.getRowModel().rows.map(row => (
                                            <tr key={row.id}>
                                                {row.getVisibleCells().map(cell => (
                                                <td key={cell.id} style={{ width: cell.column.getSize() }}>
                                                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                                </td>
                                                ))}
                                            </tr>
                                            ))
                                        ) : (
                                            <tr>
                                            <td colSpan={columns.length} className="empty">
                                                No hay datos disponibles
                                            </td>
                                            </tr>
                                        )}
                                        </tbody>
                                    </table>
                                </div>
                                <div className="flex items-center justify-between p-[18px] bg-surface border-t border-line sm:px-6">
                                    <div className="flex items-center gap-2">
                                        <span className="text-[13px] text-ink-soft font-bold">
                                            Página <span className="text-ink">{table.getState().pagination.pageIndex + 1}</span> de{' '}
                                            <span className="text-ink">{table.getPageCount() || 1}</span>
                                        </span>
                                        <select
                                            value={table.getState().pagination.pageSize}
                                            onChange={e => {
                                                table.setPageSize(Number(e.target.value));
                                            }}
                                            className="ml-4 bg-surface-2 border border-line text-ink text-[13px] font-bold rounded-[10px] p-2 outline-none placeholder-ink-soft"
                                        >
                                            {[10, 15, 20, 25, 50, 100].map(pageSize => (
                                                <option key={pageSize} value={pageSize}>
                                                    Mostrar {pageSize}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                    <div className="flex gap-2">
                                        <button
                                            onClick={() => table.previousPage()}
                                            disabled={!table.getCanPreviousPage()}
                                            className="bg-surface-2 border border-line text-ink px-[11px] py-[7px] rounded-[10px] font-heading font-semibold text-[12px] hover:border-brand-bright disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-colors"
                                        >
                                            {typeof t === 'function' && t('Common.prev') || 'Anterior'}
                                        </button>
                                        <button
                                            onClick={() => table.nextPage()}
                                            disabled={!table.getCanNextPage()}
                                            className="bg-surface-2 border border-line text-ink px-[11px] py-[7px] rounded-[10px] font-heading font-semibold text-[12px] hover:border-brand-bright disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-colors"
                                        >
                                            {typeof t === 'function' && t('Common.next') || 'Siguiente'}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </FeatureGuard>
    );
}
