"use client";
import React, { useState, useEffect, useMemo } from 'react';
import { toast } from 'sonner';
import { useMsal } from '@azure/msal-react';
import { useTenant } from '../TenantProvider';
import { useSubscription } from '../SubscriptionProvider';
import FeatureGuard from '../FeatureGuard';
import { getMockDataForRoute, isMockTenant } from '@/lib/mockData';
import { getFreshIdToken } from '@/lib/msalToken';
import { hasAccess } from '@/lib/tierLogic';

const MOCK_SCHEDULES = [
    {
        id: 'mock-sched-1', vm_name: 'dev-vm-loadtest-01', shutdown_time: '20:00:00', gmt_offset: '-05:00',
        smart_shutdown_enabled: true, max_cpu_percentage: 10,
        last_executed_date: new Date(Date.now() - 86400000).toISOString().slice(0, 10), last_execution_status: 'executed',
    },
    {
        id: 'mock-sched-2', vm_name: 'app-prod-vm-02', shutdown_time: '22:30:00', gmt_offset: '-05:00',
        smart_shutdown_enabled: false, max_cpu_percentage: 10,
        last_executed_date: new Date(Date.now() - 172800000).toISOString().slice(0, 10), last_execution_status: 'skipped_cpu',
    },
];
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
    const [schedules, setSchedules] = useState<any[]>([]);
    const [schedulesLoading, setSchedulesLoading] = useState(false);
    const [savingSchedule, setSavingSchedule] = useState(false);
    
    let t: any = (key: string) => key === 'prev' ? 'Anterior' : 'Siguiente';
    try {
      const nextIntl = require('next-intl');
      if (nextIntl && nextIntl.useTranslations) {
        t = nextIntl.useTranslations();
      }
    } catch (e) {}

    const getAuthHeaders = async (): Promise<Record<string, string>> => {
        const idToken = await getFreshIdToken(instance, accounts[0]);
        return { 'Authorization': `Bearer ${idToken}` };
    };

    const loadSchedules = async () => {
        if (!selectedTenant || selectedTenant.id === 'default' || (accounts.length === 0 && !isMockTenant(selectedTenant.id))) return;
        if (isMockTenant(selectedTenant.id)) {
            setSchedules(MOCK_SCHEDULES);
            return;
        }
        setSchedulesLoading(true);
        try {
            const headers = await getAuthHeaders();
            const res = await fetch(`/api/power/schedule?tenantId=${selectedTenant.id}`, { headers });
            const json = await res.json();
            if (res.ok) setSchedules(Array.isArray(json.schedules) ? json.schedules : []);
        } catch (e) {
            console.error("Error cargando power schedules:", e);
        }
        setSchedulesLoading(false);
    };

    useEffect(() => {
        void loadSchedules();
        // Refresco periodico: el cron /api/cron/power-schedules apaga VMs en el
        // servidor de forma independiente a esta pestana, asi que sin polling
        // la tabla de "Ultima Ejecucion" queda mostrando el estado previo hasta
        // que el usuario recargue manualmente. 60s es suficiente sin generar
        // carga relevante (misma cadencia de referencia que el cron, cada 10min).
        const intervalId = setInterval(() => {
            void loadSchedules();
        }, 60_000);
        return () => clearInterval(intervalId);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [accounts, instance, selectedTenant.id]);

    const handleSetSchedule = async () => {
        if (!scheduleVmName || !shutdownTime) return;
        const vm = vms.find(v => v.name === scheduleVmName);
        if (!vm) {
            toast.error('Máquina no encontrada. Refresca la lista de VMs e intenta de nuevo.');
            return;
        }
        if (isMockTenant(selectedTenant.id)) {
            toast(`[SIMULACIÓN DEMO] Horario configurado para ${scheduleVmName} a las ${shutdownTime} (GMT ${gmtOffset}).`, { icon: '🧪' });
            setScheduleVmName('');
            setShutdownTime('');
            return;
        }
        setSavingSchedule(true);
        try {
            const headers = await getAuthHeaders();
            const res = await fetch('/api/power/schedule', {
                method: 'POST',
                headers: { ...headers, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    tenantId: selectedTenant.id,
                    subscriptionId: vm.subscriptionId,
                    resourceGroup: vm.resourceGroup,
                    vmName: vm.name,
                    shutdownTime,
                    gmtOffset,
                    smartShutdownEnabled,
                    maxCpuPercentage,
                    idleDurationMinutes,
                })
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error || 'Error al guardar el horario');
            setSchedules(Array.isArray(json.schedules) ? json.schedules : []);
            toast.success(`Horario de apagado guardado para ${scheduleVmName} a las ${shutdownTime} (GMT ${gmtOffset}).`);
            setScheduleVmName('');
            setShutdownTime('');
        } catch (e: any) {
            toast.error(`No se pudo guardar el horario: ${e.message}`);
        }
        setSavingSchedule(false);
    };

    const handleDeleteSchedule = async (id: number, vmName: string) => {
        if (!window.confirm(`¿Eliminar el horario de apagado de ${vmName}?`)) return;
        try {
            const headers = await getAuthHeaders();
            const res = await fetch(`/api/power/schedule?tenantId=${selectedTenant.id}&id=${id}`, {
                method: 'DELETE',
                headers,
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error || 'Error al eliminar el horario');
            setSchedules(Array.isArray(json.schedules) ? json.schedules : []);
            toast.success(`Horario de ${vmName} eliminado.`);
        } catch (e: any) {
            toast.error(`No se pudo eliminar el horario: ${e.message}`);
        }
    };

    useEffect(() => {
        if ((accounts.length === 0 && !isMockTenant(selectedTenant.id)) || selectedTenant.id === 'default') return;
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
        // Mismo motivo que en loadSchedules: refrescar el powerState real de las
        // VMs para que "Encendida"/"Apagada" no quede desactualizado cuando el
        // cron de Power Schedules apaga una maquina mientras la pestana esta abierta.
        const intervalId = setInterval(() => {
            fetchVms();
        }, 60_000);
        return () => clearInterval(intervalId);
    }, [accounts, instance, selectedTenant.id, selectedSubscription, refetchTick]);

    const handleAction = async (action: 'start' | 'stop' | 'restart', singleVm?: any) => {
        const targetVms = singleVm ? [singleVm] : vms.filter(vm => selectedVmIds.includes(vm.id));
        if (targetVms.length === 0) {
            toast('No hay VMs seleccionadas. Marca al menos una VM para ejecutar la acción.', { icon: 'ℹ️' });
            return;
        }
        
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

    if ((accounts.length === 0 && !isMockTenant(selectedTenant.id)) || selectedTenant.id === 'default') return null;

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
                                disabled={!scheduleVmName || !shutdownTime || savingSchedule}
                            >
                                {savingSchedule ? 'Guardando...' : 'Establecer'}
                            </button>
                        </div>
                    </div>

                    {(schedulesLoading || schedules.length > 0) && (
                        <div className="border border-line rounded-[14px] overflow-hidden bg-surface mb-6">
                            <div className="px-4 py-3 border-b border-line bg-surface-2">
                                <h4 className="text-[13px] font-bold text-ink m-0">Horarios de Apagado Configurados</h4>
                            </div>
                            {schedulesLoading ? (
                                <div className="empty animate-pulse">Cargando horarios...</div>
                            ) : (
                                <div className="overflow-x-auto w-full">
                                    <table className="tbl w-full">
                                        <thead>
                                            <tr>
                                                <th>Máquina Virtual</th>
                                                <th>Hora de Apagado</th>
                                                <th>Zona Horaria</th>
                                                <th>Smart Shutdown</th>
                                                <th>Última Ejecución</th>
                                                <th></th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {schedules.map((s: any) => (
                                                <tr key={s.id}>
                                                    <td className="text-sm font-semibold text-gray-900 dark:text-gray-100">{s.vm_name}</td>
                                                    <td className="text-sm text-gray-500 dark:text-gray-400">{String(s.shutdown_time).slice(0, 5)}</td>
                                                    <td className="text-sm text-gray-500 dark:text-gray-400">GMT{s.gmt_offset}</td>
                                                    <td className="text-sm text-gray-500 dark:text-gray-400">{s.smart_shutdown_enabled ? `Sí (≤${s.max_cpu_percentage}% CPU)` : 'No'}</td>
                                                    <td className="text-sm text-gray-500 dark:text-gray-400">
                                                        {s.last_executed_date
                                                            ? `${s.last_executed_date} — ${s.last_execution_status === 'executed' ? 'Apagada' : s.last_execution_status === 'skipped_cpu' ? 'Omitida (CPU activa)' : s.last_execution_status === 'failed' ? 'Falló' : s.last_execution_status || ''}`
                                                            : 'Aún no ejecutado'}
                                                    </td>
                                                    <td className="text-right">
                                                        <button
                                                            onClick={() => handleDeleteSchedule(s.id, s.vm_name)}
                                                            className="text-xs bg-red-50 text-red-700 px-2 py-1 border border-red-200 rounded hover:bg-red-100 transition-colors"
                                                        >
                                                            Eliminar
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    )}

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
