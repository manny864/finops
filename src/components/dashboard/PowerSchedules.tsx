"use client";
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { toast } from 'sonner';
import { useMsal } from '@azure/msal-react';
import { useTenant } from '../TenantProvider';
import { useTenantTimezone } from '@/hooks/useTenantTimezone';
import { useSubscription } from '../SubscriptionProvider';
import FeatureGuard from '../FeatureGuard';
import { getMockDataForRoute, isMockTenant } from '@/lib/mockData';
import { getFreshIdToken } from '@/lib/msalToken';
import { hasAccess } from '@/lib/tierLogic';

const GMT_OFFSETS: { value: string; label: string }[] = [
    { value: '-12:00', label: 'GMT-12:00' },
    { value: '-11:00', label: 'GMT-11:00' },
    { value: '-10:00', label: 'GMT-10:00' },
    { value: '-09:00', label: 'GMT-09:00' },
    { value: '-08:00', label: 'GMT-08:00 (PST)' },
    { value: '-07:00', label: 'GMT-07:00 (MST)' },
    { value: '-06:00', label: 'GMT-06:00 (CST)' },
    { value: '-05:00', label: 'GMT-05:00 (EST/COT)' },
    { value: '-04:00', label: 'GMT-04:00 (AST)' },
    { value: '-03:30', label: 'GMT-03:30' },
    { value: '-03:00', label: 'GMT-03:00 (ART/BRT)' },
    { value: '-02:00', label: 'GMT-02:00' },
    { value: '-01:00', label: 'GMT-01:00' },
    { value: '+00:00', label: 'GMT+00:00 (UTC)' },
    { value: '+01:00', label: 'GMT+01:00 (CET)' },
    { value: '+02:00', label: 'GMT+02:00' },
    { value: '+03:00', label: 'GMT+03:00' },
    { value: '+03:30', label: 'GMT+03:30' },
    { value: '+04:00', label: 'GMT+04:00' },
    { value: '+04:30', label: 'GMT+04:30' },
    { value: '+05:00', label: 'GMT+05:00' },
    { value: '+05:30', label: 'GMT+05:30' },
    { value: '+05:45', label: 'GMT+05:45' },
    { value: '+06:00', label: 'GMT+06:00' },
    { value: '+06:30', label: 'GMT+06:30' },
    { value: '+07:00', label: 'GMT+07:00' },
    { value: '+08:00', label: 'GMT+08:00' },
    { value: '+08:45', label: 'GMT+08:45' },
    { value: '+09:00', label: 'GMT+09:00 (JST)' },
    { value: '+09:30', label: 'GMT+09:30' },
    { value: '+10:00', label: 'GMT+10:00 (AEST)' },
    { value: '+10:30', label: 'GMT+10:30' },
    { value: '+11:00', label: 'GMT+11:00' },
    { value: '+12:00', label: 'GMT+12:00' },
    { value: '+13:00', label: 'GMT+13:00' },
    { value: '+14:00', label: 'GMT+14:00' },
];

const DAYS_OF_WEEK_OPTIONS: { iso: number; short: string; label: string }[] = [
    { iso: 1, short: 'L', label: 'Lunes' },
    { iso: 2, short: 'M', label: 'Martes' },
    { iso: 3, short: 'X', label: 'Miércoles' },
    { iso: 4, short: 'J', label: 'Jueves' },
    { iso: 5, short: 'V', label: 'Viernes' },
    { iso: 6, short: 'S', label: 'Sábado' },
    { iso: 7, short: 'D', label: 'Domingo' },
];

/** Zona horaria del navegador del cliente, formateada como "+HH:MM"/"-HH:MM"
 *  para preseleccionar el combo de Zona Horaria — antes quedaba hardcodeado
 *  en GMT-05:00 sin importar desde dónde accediera el usuario. Se calcula a
 *  partir de `Date.prototype.getTimezoneOffset()` (minutos que el reloj LOCAL
 *  del browser está detrás de UTC, con el signo invertido respecto al que
 *  usamos acá) en vez de mapear el nombre IANA (`Intl...timeZone`) — así
 *  refleja el offset real vigente en este momento (contempla horario de
 *  verano/DST automáticamente) sin necesitar una tabla de conversión aparte.
 *  Si el offset resultante no está entre las opciones soportadas (caso raro,
 *  ej. +12:45 Chatham), cae al `fallback` para no dejar el combo en un valor
 *  que no matchea ninguna opción visible. */
function getBrowserGmtOffset(fallback: string): string {
    if (typeof Date === 'undefined') return fallback;
    const offsetMin = -new Date().getTimezoneOffset();
    const sign = offsetMin >= 0 ? '+' : '-';
    const abs = Math.abs(offsetMin);
    const hh = String(Math.floor(abs / 60)).padStart(2, '0');
    const mm = String(abs % 60).padStart(2, '0');
    const computed = `${sign}${hh}:${mm}`;
    return GMT_OFFSETS.some(o => o.value === computed) ? computed : fallback;
}

/** Texto de la columna "Fecha / Días" de la tabla de horarios: fecha puntual
 *  (one-off), días de la semana (recurrencia semanal) o "Diario" (todos los
 *  días, comportamiento original sin cambios). */
function formatScheduleRecurrence(s: { schedule_date?: string | null; days_of_week?: string | null }): string {
    if (s.schedule_date) return String(s.schedule_date).slice(0, 10);
    if (s.days_of_week) {
        const isoDays = String(s.days_of_week).split(',').map(d => parseInt(d.trim(), 10));
        return DAYS_OF_WEEK_OPTIONS.filter(d => isoDays.includes(d.iso)).map(d => d.short).join(' ');
    }
    return 'Diario';
}

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
    const [scheduleActionType, setScheduleActionType] = useState<'shutdown' | 'start' | 'restart'>('shutdown');
    const [shutdownTime, setShutdownTime] = useState('');
    // Lazy initializer: corre una sola vez al montar, ya en el cliente (el
    // componente es "use client" y el guard de auth de más abajo hace que el
    // SSR no llegue a renderizar este formulario, así que no hay riesgo de
    // hydration mismatch por usar la TZ del browser acá).
    const [gmtOffset, setGmtOffset] = useState(() => getBrowserGmtOffset('-05:00'));
    // gmt_offset queda por compatibilidad con las filas viejas, pero lo que
    // manda es la zona IANA: es la única que recalcula el offset en cada
    // ejecución y por lo tanto sobrevive al horario de verano. Un horario
    // guardado en julio en Madrid con offset fijo +02:00 apagaba las VMs una
    // hora antes desde noviembre.
    const scheduleTimeZone = useTenantTimezone();
    const [scheduleDate, setScheduleDate] = useState('');
    // Modo "recurrente por rango": en vez de una sola hora+acción, el usuario
    // elige días de la semana + "Desde"/"Hasta" — se traduce a DOS schedules
    // (start a la hora "desde", shutdown a la hora "hasta") compartiendo el
    // mismo days_of_week (ver handleSetSchedule).
    const [scheduleMode, setScheduleMode] = useState<'single' | 'range'>('single');
    const [rangeDays, setRangeDays] = useState<number[]>([]);
    const [rangeFrom, setRangeFrom] = useState('');
    const [rangeTo, setRangeTo] = useState('');
    const [smartShutdownEnabled, setSmartShutdownEnabled] = useState(false);
    const [maxCpuPercentage, setMaxCpuPercentage] = useState(10);
    const [idleDurationMinutes, setIdleDurationMinutes] = useState(60);
    const [schedules, setSchedules] = useState<any[]>([]);
    const [schedulesLoading, setSchedulesLoading] = useState(false);
    const [savingSchedule, setSavingSchedule] = useState(false);

    // Tenant "vivo" al momento de cada fetch — se actualiza en cada render
    // (no en un efecto), así que un fetch de loadSchedules/fetchVms lanzado
    // para el tenant anterior puede detectar, al resolver, que el usuario ya
    // cambió de tenant y descartar su resultado en vez de pisar el estado con
    // horarios/VMs que no pertenecen al tenant activo (riesgo real acá: los
    // botones Start/Stop/Restart/Delete operan sobre lo que esta tabla muestra).
    const activeTenantIdRef = useRef(selectedTenant.id);
    activeTenantIdRef.current = selectedTenant.id;

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
        const requestedTenantId = selectedTenant.id;
        if (isMockTenant(selectedTenant.id)) {
            setSchedules(MOCK_SCHEDULES);
            return;
        }
        setSchedulesLoading(true);
        try {
            const headers = await getAuthHeaders();
            const res = await fetch(`/api/power/schedule?tenantId=${requestedTenantId}`, { headers });
            const json = await res.json();
            if (activeTenantIdRef.current !== requestedTenantId) return;
            if (res.ok) setSchedules(Array.isArray(json.schedules) ? json.schedules : []);
        } catch (e) {
            console.error("Error cargando power schedules:", e);
        }
        if (activeTenantIdRef.current === requestedTenantId) setSchedulesLoading(false);
    };

    useEffect(() => {
        void loadSchedules();
        // Refresco periodico: el cron /api/cron/power-schedules apaga VMs en el
        // servidor de forma independiente a esta pestana, asi que sin polling
        // la tabla de "Ultima Ejecucion" queda mostrando el estado previo hasta
        // que el usuario recargue manualmente. 30s (pedido explicito del
        // usuario, antes 60s) para que el cambio de estado se vea mas rapido.
        const intervalId = setInterval(() => {
            void loadSchedules();
        }, 30_000);
        return () => clearInterval(intervalId);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [accounts, instance, selectedTenant.id]);

    const handleSetSingleSchedule = async () => {
        if (!scheduleVmName || !shutdownTime) return;
        const vm = vms.find(v => v.name === scheduleVmName);
        if (!vm) {
            toast.error('Máquina no encontrada. Refresca la lista de VMs e intenta de nuevo.');
            return;
        }
        // Horario "one-off" (fecha específica, no diario): si ya pasó, el cron
        // nunca lo va a considerar "debido" y queda inválido para siempre sin
        // ningún aviso — se avisa acá antes de guardarlo (el backend también
        // lo rechaza, esto es solo para feedback inmediato sin round-trip).
        if (scheduleDate) {
            const [hh, mm] = shutdownTime.split(':').map(Number);
            const [y, mo, d] = scheduleDate.split('-').map(Number);
            const offMatch = /^([+-])(\d{2}):(\d{2})$/.exec(gmtOffset);
            const offsetMin = offMatch ? (offMatch[1] === '-' ? -1 : 1) * (parseInt(offMatch[2], 10) * 60 + parseInt(offMatch[3], 10)) : 0;
            const scheduledUtcMs = Date.UTC(y, mo - 1, d, hh, mm) - offsetMin * 60000;
            if (scheduledUtcMs <= Date.now()) {
                toast.error('La fecha y hora elegidas ya pasaron. Como es un horario de fecha específica (no diario), nunca se va a ejecutar — elegí una fecha/hora futura.');
                return;
            }
        }
        const actionLabel = scheduleActionType === 'start' ? 'encendido' : scheduleActionType === 'restart' ? 'reinicio' : 'apagado';
        if (isMockTenant(selectedTenant.id)) {
            toast(`[SIMULACIÓN DEMO] Horario de ${actionLabel} configurado para ${scheduleVmName} a las ${shutdownTime} (GMT ${gmtOffset})${scheduleDate ? ` el ${scheduleDate}` : ' (diario)'}.`, { icon: '🧪' });
            setScheduleVmName('');
            setShutdownTime('');
            setScheduleDate('');
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
                    actionType: scheduleActionType,
                    shutdownTime,
                    gmtOffset,
                    timeZone: scheduleTimeZone,
                    scheduleDate: scheduleDate || null,
                    smartShutdownEnabled,
                    maxCpuPercentage,
                    idleDurationMinutes,
                })
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error || 'Error al guardar el horario');
            setSchedules(Array.isArray(json.schedules) ? json.schedules : []);
            toast.success(`Horario de ${actionLabel} guardado para ${scheduleVmName} a las ${shutdownTime} (GMT ${gmtOffset})${scheduleDate ? ` el ${scheduleDate}` : ' (diario)'}.`);
            setScheduleVmName('');
            setShutdownTime('');
            setScheduleDate('');
        } catch (e: any) {
            toast.error(`No se pudo guardar el horario: ${e.message}`);
        }
        setSavingSchedule(false);
    };

    const handleSetRangeSchedule = async () => {
        if (!scheduleVmName || !rangeFrom || !rangeTo || rangeDays.length === 0) return;
        const vm = vms.find(v => v.name === scheduleVmName);
        if (!vm) {
            toast.error('Máquina no encontrada. Refresca la lista de VMs e intenta de nuevo.');
            return;
        }
        const daysOfWeekCsv = [...rangeDays].sort((a, b) => a - b).join(',');
        const daysLabel = DAYS_OF_WEEK_OPTIONS.filter(d => rangeDays.includes(d.iso)).map(d => d.short).join('');

        if (isMockTenant(selectedTenant.id)) {
            toast(`[SIMULACIÓN DEMO] Horario recurrente para ${scheduleVmName}: encendido ${rangeFrom} / apagado ${rangeTo} (GMT ${gmtOffset}) los días ${daysLabel}.`, { icon: '🧪' });
            setScheduleVmName('');
            setRangeFrom('');
            setRangeTo('');
            setRangeDays([]);
            return;
        }

        setSavingSchedule(true);
        try {
            const headers = await getAuthHeaders();
            const basePayload = {
                tenantId: selectedTenant.id,
                subscriptionId: vm.subscriptionId,
                resourceGroup: vm.resourceGroup,
                vmName: vm.name,
                gmtOffset,
                timeZone: scheduleTimeZone,
                daysOfWeek: daysOfWeekCsv,
            };
            // Dos filas independientes (la unique key incluye action_type, así
            // que "start" y "shutdown" nunca colisionan): una a la hora
            // "Desde" (encender) y otra a la hora "Hasta" (apagar), ambas con
            // el mismo days_of_week — reusa el motor existente de
            // una-fila-por-acción en vez de modelar un "rango" nuevo en la DB.
            const [resStart, resStop] = await Promise.all([
                fetch('/api/power/schedule', {
                    method: 'POST',
                    headers: { ...headers, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ...basePayload, actionType: 'start', shutdownTime: rangeFrom }),
                }),
                fetch('/api/power/schedule', {
                    method: 'POST',
                    headers: { ...headers, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ...basePayload, actionType: 'shutdown', shutdownTime: rangeTo, smartShutdownEnabled, maxCpuPercentage, idleDurationMinutes }),
                }),
            ]);
            const [jsonStart, jsonStop] = await Promise.all([resStart.json(), resStop.json()]);
            if (!resStart.ok) throw new Error(jsonStart.error || 'Error al guardar el encendido ("Desde")');
            if (!resStop.ok) throw new Error(jsonStop.error || 'Error al guardar el apagado ("Hasta")');
            setSchedules(Array.isArray(jsonStop.schedules) ? jsonStop.schedules : []);
            toast.success(`Horario recurrente guardado para ${scheduleVmName}: encendido ${rangeFrom} / apagado ${rangeTo} (GMT ${gmtOffset}) los días ${daysLabel}.`);
            setScheduleVmName('');
            setRangeFrom('');
            setRangeTo('');
            setRangeDays([]);
        } catch (e: any) {
            toast.error(`No se pudo guardar el horario recurrente: ${e.message}`);
        }
        setSavingSchedule(false);
    };

    const handleSetSchedule = () => (scheduleMode === 'range' ? handleSetRangeSchedule() : handleSetSingleSchedule());

    const toggleRangeDay = (iso: number) => {
        setRangeDays(prev => prev.includes(iso) ? prev.filter(d => d !== iso) : [...prev, iso].sort((a, b) => a - b));
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
            const requestedTenantId = selectedTenant.id;
            setLoading(true);
            try {
                let json;
                if (isMockTenant(requestedTenantId)) {
                    json = getMockDataForRoute('audit_full', requestedTenantId);
                } else {
                    const tokenResponse = await instance.acquireTokenSilent({
                        scopes: ["User.Read"],
                        account: accounts[0]
                    });
                    const subParam = selectedSubscription && selectedSubscription.toLowerCase() !== 'all'
                        ? `&subscriptionId=${selectedSubscription}`
                        : '';
                    const res = await fetch(`/api/power?tenantId=${requestedTenantId}${subParam}`, {
                        headers: { 'Authorization': `Bearer ${tokenResponse.idToken}` }
                    });
                    if (!res.ok) {
                        throw new Error(`Power VM fetch failed: ${res.status}`);
                    }
                    json = await res.json();
                }

                if (activeTenantIdRef.current !== requestedTenantId) return;

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
            if (activeTenantIdRef.current === requestedTenantId) setLoading(false);
        };
        fetchVms();
        // Mismo motivo que en loadSchedules: refrescar el powerState real de las
        // VMs para que "Encendida"/"Apagada" no quede desactualizado cuando el
        // cron de Power Schedules apaga una maquina mientras la pestana esta abierta.
        // 30s (pedido explicito del usuario, antes 60s).
        const intervalId = setInterval(() => {
            fetchVms();
        }, 30_000);
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

    const isPro = hasAccess(selectedTenant.tier || 'Professional', 'Professional');

    return (
        <FeatureGuard requiredTier="Professional" featureName="VM Control" className="h-full">
            <div className="card h-full flex flex-col overflow-hidden">
                <div className="card-h shrink-0">
                    <div className="flex flex-col">
                        <h3 className="m-0">{t('Dashboard.vm_control')}</h3>
                        <p className="text-[13px] text-ink-soft m-0 mt-1 font-normal">{t('Dashboard.vm_control_desc')}</p>
                    </div>
                </div>
                
                <div className="p-[18px] flex-1 overflow-y-auto custom-scrollbar">
                    <div className="bg-surface-2 p-[18px] rounded-[10px] border border-line mb-6 flex flex-col gap-4">
                        <div className="flex gap-2">
                            <button
                                type="button"
                                onClick={() => setScheduleMode('single')}
                                className={`px-3 py-1.5 rounded-[8px] text-[12px] font-bold transition-colors ${scheduleMode === 'single' ? 'bg-brand-deep text-white' : 'bg-surface border border-line text-ink-soft hover:text-ink'}`}
                            >
                                Hora única
                            </button>
                            <button
                                type="button"
                                onClick={() => setScheduleMode('range')}
                                className={`px-3 py-1.5 rounded-[8px] text-[12px] font-bold transition-colors ${scheduleMode === 'range' ? 'bg-brand-deep text-white' : 'bg-surface border border-line text-ink-soft hover:text-ink'}`}
                            >
                                Recurrente (días + rango)
                            </button>
                        </div>

                        <div className="flex flex-col md:flex-row items-end gap-4 flex-wrap">
                            <div className="w-full md:w-1/4">
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

                            {scheduleMode === 'single' ? (
                                <>
                                    <div className="w-full md:w-1/6">
                                        <label className="text-[11px] font-bold text-grey uppercase tracking-[0.5px] block mb-2">Acción</label>
                                        <select
                                            value={scheduleActionType}
                                            onChange={(e) => setScheduleActionType(e.target.value as 'shutdown' | 'start' | 'restart')}
                                            className="w-full bg-surface border border-line text-ink text-[13px] font-bold rounded-[10px] focus:border-brand-bright focus:ring-1 focus:ring-brand-bright p-2 outline-none placeholder-ink-soft"
                                        >
                                            <option value="shutdown">Apagar</option>
                                            <option value="start">Encender</option>
                                            <option value="restart">Reiniciar</option>
                                        </select>
                                    </div>
                                    <div className="w-full md:w-1/6">
                                        <label className="text-[11px] font-bold text-grey uppercase tracking-[0.5px] block mb-2">Hora</label>
                                        <input
                                            type="time"
                                            value={shutdownTime}
                                            onChange={(e) => setShutdownTime(e.target.value)}
                                            className="w-full bg-surface border border-line text-ink text-[13px] font-bold rounded-[10px] focus:border-brand-bright focus:ring-1 focus:ring-brand-bright p-2 outline-none placeholder-ink-soft"
                                        />
                                    </div>
                                    <div className="w-full md:w-1/6">
                                        <label className="text-[11px] font-bold text-grey uppercase tracking-[0.5px] block mb-2">Fecha (opcional)</label>
                                        <input
                                            type="date"
                                            value={scheduleDate}
                                            onChange={(e) => setScheduleDate(e.target.value)}
                                            title="Dejar vacío para que se repita todos los días. Si elegís una fecha, corre una única vez ese día."
                                            className="w-full bg-surface border border-line text-ink text-[13px] font-bold rounded-[10px] focus:border-brand-bright focus:ring-1 focus:ring-brand-bright p-2 outline-none placeholder-ink-soft"
                                        />
                                    </div>
                                </>
                            ) : (
                                <>
                                    <div className="w-full md:w-auto">
                                        <label className="text-[11px] font-bold text-grey uppercase tracking-[0.5px] block mb-2">Días de la semana</label>
                                        <div className="flex gap-1">
                                            {DAYS_OF_WEEK_OPTIONS.map(d => (
                                                <button
                                                    key={d.iso}
                                                    type="button"
                                                    title={d.label}
                                                    onClick={() => toggleRangeDay(d.iso)}
                                                    className={`w-8 h-8 rounded-full text-[12px] font-bold transition-colors ${rangeDays.includes(d.iso) ? 'bg-brand-deep text-white' : 'bg-surface border border-line text-ink-soft hover:text-ink'}`}
                                                >
                                                    {d.short}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                    <div className="w-full md:w-1/6">
                                        <label className="text-[11px] font-bold text-grey uppercase tracking-[0.5px] block mb-2">Desde (encender)</label>
                                        <input
                                            type="time"
                                            value={rangeFrom}
                                            onChange={(e) => setRangeFrom(e.target.value)}
                                            className="w-full bg-surface border border-line text-ink text-[13px] font-bold rounded-[10px] focus:border-brand-bright focus:ring-1 focus:ring-brand-bright p-2 outline-none placeholder-ink-soft"
                                        />
                                    </div>
                                    <div className="w-full md:w-1/6">
                                        <label className="text-[11px] font-bold text-grey uppercase tracking-[0.5px] block mb-2">Hasta (apagar)</label>
                                        <input
                                            type="time"
                                            value={rangeTo}
                                            onChange={(e) => setRangeTo(e.target.value)}
                                            className="w-full bg-surface border border-line text-ink text-[13px] font-bold rounded-[10px] focus:border-brand-bright focus:ring-1 focus:ring-brand-bright p-2 outline-none placeholder-ink-soft"
                                        />
                                    </div>
                                </>
                            )}

                            <div className="w-full md:w-1/4">
                                <label className="text-[11px] font-bold text-grey uppercase tracking-[0.5px] block mb-2">Zona Horaria</label>
                                <select
                                    value={gmtOffset}
                                    onChange={(e) => setGmtOffset(e.target.value)}
                                    className="w-full bg-surface border border-line text-ink text-[13px] font-bold rounded-[10px] focus:border-brand-bright focus:ring-1 focus:ring-brand-bright p-2 outline-none placeholder-ink-soft"
                                >
                                    {GMT_OFFSETS.map(o => (
                                        <option key={o.value} value={o.value}>{o.label}</option>
                                    ))}
                                </select>
                            </div>
                            <div className="w-full md:w-auto">
                                <button
                                    onClick={handleSetSchedule}
                                    className="w-full bg-brand-deep text-white px-[11px] py-[7px] rounded-[10px] font-heading font-bold text-[12px] hover:brightness-110 shadow-sm transition-colors cursor-pointer disabled:opacity-50"
                                    disabled={savingSchedule || (scheduleMode === 'single' ? (!scheduleVmName || !shutdownTime) : (!scheduleVmName || !rangeFrom || !rangeTo || rangeDays.length === 0))}
                                >
                                    {savingSchedule ? 'Guardando...' : 'Establecer'}
                                </button>
                            </div>
                        </div>
                    </div>

                    {(schedulesLoading || schedules.length > 0) && (
                        <div className="border border-line rounded-[14px] overflow-hidden bg-surface mb-6">
                            <div className="px-4 py-3 border-b border-line bg-surface-2">
                                <h4 className="text-[13px] font-bold text-ink m-0">Horarios Programados</h4>
                            </div>
                            {schedulesLoading ? (
                                <div className="empty animate-pulse">Cargando horarios...</div>
                            ) : (
                                <div className="overflow-x-auto w-full">
                                    <table className="tbl w-full">
                                        <thead>
                                            <tr>
                                                <th>Máquina Virtual</th>
                                                <th>Acción</th>
                                                <th>Hora</th>
                                                <th>Fecha / Días</th>
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
                                                    <td className="text-sm text-gray-500 dark:text-gray-400">
                                                        {s.action_type === 'start' ? 'Encender' : s.action_type === 'restart' ? 'Reiniciar' : 'Apagar'}
                                                    </td>
                                                    <td className="text-sm text-gray-500 dark:text-gray-400">{String(s.shutdown_time).slice(0, 5)}</td>
                                                    <td className="text-sm text-gray-500 dark:text-gray-400">{formatScheduleRecurrence(s)}</td>
                                                    <td className="text-sm text-gray-500 dark:text-gray-400">GMT{s.gmt_offset}</td>
                                                    <td className="text-sm text-gray-500 dark:text-gray-400">{s.action_type && s.action_type !== 'shutdown' ? '—' : (s.smart_shutdown_enabled ? `Sí (≤${s.max_cpu_percentage}% CPU)` : 'No')}</td>
                                                    <td className="text-sm text-gray-500 dark:text-gray-400">
                                                        {s.last_executed_date
                                                            ? `${s.last_executed_date} — ${s.last_execution_status === 'executed' ? 'Ejecutado' : s.last_execution_status === 'skipped_cpu' ? 'Omitida (CPU activa)' : s.last_execution_status === 'failed' ? 'Falló' : s.last_execution_status || ''}`
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
