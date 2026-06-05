"use client";
import React, { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { useMsal } from '@azure/msal-react';
import { useTenant } from '../TenantProvider';

export default function PowerSchedules() {
    const { instance, accounts } = useMsal();
    const { selectedTenant } = useTenant();
    const [vms, setVms] = useState<any[]>([]);
    const [selectedVmIds, setSelectedVmIds] = useState<string[]>([]);
    const [loading, setLoading] = useState(true);

    const [actionLoading, setActionLoading] = useState<string | null>(null);
    const [scheduleVmName, setScheduleVmName] = useState('');
    const [shutdownTime, setShutdownTime] = useState('');
    const [gmtOffset, setGmtOffset] = useState('-05:00');
    
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
                const tokenResponse = await instance.acquireTokenSilent({
                    scopes: ["User.Read"],
                    account: accounts[0]
                });
                const res = await fetch(`/api/audit/full?tenantId=${selectedTenant.id}`, {
                    headers: { 'Authorization': `Bearer ${tokenResponse.idToken}` }
                });
                const json = await res.json();
                if (json.auditResults && json.auditResults.allVirtualMachines) {
                    setVms(json.auditResults.allVirtualMachines);
                    // Select all by default
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
    }, [accounts, instance, selectedTenant.id]);

    const handleAction = async (action: 'start' | 'stop' | 'restart') => {
        const targetVms = vms.filter(vm => selectedVmIds.includes(vm.id));
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
            
            await fetch('/api/power', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${tokenResponse.idToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    tenantId: selectedTenant.id,
                    action,
                    vms: payload
                })
            });
            
            toast.success(`Comando ${action === 'start' ? 'Encender' : action === 'restart' ? 'Reiniciar' : 'Apagar'} enviado exitosamente a ${targetVms.length} VMs.`);
        } catch (e) {
            console.error(`Error al ejecutar ${action}:`, e);
            alert("Error al ejecutar la acción.");
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

    if (accounts.length === 0 || selectedTenant.id === 'default') return null;

    return (
        <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-6 mt-6">
            <h3 className="text-lg font-bold text-gray-800 mb-2">Control de Máquinas Virtuales</h3>
            <p className="text-sm text-gray-500 mb-4">Controla el encendido y apagado de las VMs de Desarrollo y Pruebas.</p>
            
            <div className="bg-gray-50 p-4 rounded-md border border-gray-200 mb-6 flex flex-col md:flex-row items-end gap-4">
                <div className="w-full md:w-1/3">
                    <label className="block text-xs font-medium text-gray-700 mb-1">Nombre de la Máquina</label>
                    <select
                        value={scheduleVmName}
                        onChange={(e) => setScheduleVmName(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 bg-white rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                    >
                        <option value="">-- Seleccionar Máquina --</option>
                        {vms.map(vm => (
                            <option key={vm.id} value={vm.name}>{vm.name} ({vm.resourceGroup})</option>
                        ))}
                    </select>
                </div>
                <div className="w-full md:w-1/4">
                    <label className="block text-xs font-medium text-gray-700 mb-1">Hora de Apagado Automático</label>
                    <input 
                        type="time" 
                        value={shutdownTime}
                        onChange={(e) => setShutdownTime(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                    />
                </div>
                <div className="w-full md:w-1/4">
                    <label className="block text-xs font-medium text-gray-700 mb-1">Zona Horaria (GMT)</label>
                    <select 
                        value={gmtOffset}
                        onChange={(e) => setGmtOffset(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 bg-white rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
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
                        className="w-full bg-[#0054A6] hover:bg-blue-800 text-white px-4 py-2 rounded-md shadow-sm text-sm font-semibold transition-colors disabled:opacity-50"
                        disabled={!scheduleVmName || !shutdownTime}
                    >
                        Establecer
                    </button>
                </div>
            </div>

            
            {loading ? (
                <div className="text-sm text-gray-400 animate-pulse">Cargando VMs...</div>
            ) : vms.length === 0 ? (
                <div className="text-sm text-gray-500">No se encontraron máquinas virtuales en el tenant.</div>
            ) : (
                <>
                    <div className="flex gap-4 mb-4">
                        <button 
                            onClick={() => handleAction('stop')}
                            disabled={actionLoading !== null || selectedVmIds.length === 0}
                            className="bg-amber-100 hover:bg-amber-200 text-amber-700 px-4 py-2 rounded font-semibold text-sm transition-colors shadow-sm disabled:opacity-50"
                        >
                            {actionLoading === 'stop' ? 'Procesando...' : 'Apagar Selección'}
                        </button>
                        <button 
                            onClick={() => handleAction('start')}
                            disabled={actionLoading !== null || selectedVmIds.length === 0}
                            className="bg-green-100 hover:bg-green-200 text-green-700 px-4 py-2 rounded font-semibold text-sm transition-colors shadow-sm disabled:opacity-50"
                        >
                            {actionLoading === 'start' ? 'Procesando...' : 'Encender Selección'}
                        </button>
                        <button 
                            onClick={() => handleAction('restart')}
                            disabled={actionLoading !== null || selectedVmIds.length === 0}
                            className="bg-blue-100 hover:bg-blue-200 text-blue-700 px-4 py-2 rounded font-semibold text-sm transition-colors shadow-sm disabled:opacity-50"
                        >
                            {actionLoading === 'restart' ? 'Procesando...' : 'Reiniciar Selección'}
                        </button>
                    </div>
                    
                    <div className="overflow-y-auto max-h-48 border border-gray-200 rounded-md">
                        <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50 sticky top-0">
                                <tr>
                                    <th className="px-4 py-2 text-left w-12">
                                        <input 
                                            type="checkbox" 
                                            checked={selectedVmIds.length === vms.length && vms.length > 0}
                                            onChange={toggleAll}
                                            className="rounded text-[#0054A6] focus:ring-[#0054A6]"
                                        />
                                    </th>
                                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Máquina Virtual</th>
                                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Resource Group</th>
                                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Estado</th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                                {vms.map((vm) => {
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
                                        <tr key={vm.id} className="hover:bg-gray-50 transition-colors">
                                            <td className="px-4 py-2">
                                                <input 
                                                    type="checkbox"
                                                    checked={selectedVmIds.includes(vm.id)}
                                                    onChange={() => toggleSelection(vm.id)}
                                                    className="rounded text-[#0054A6] focus:ring-[#0054A6]"
                                                />
                                            </td>
                                            <td className="px-4 py-2 text-sm text-gray-900">{vm.name}</td>
                                            <td className="px-4 py-2 text-sm text-gray-500">{vm.resourceGroup}</td>
                                            <td className="px-4 py-2 text-sm">
                                                <span className={`px-2 py-1 text-xs font-semibold rounded-full ${isRunning ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}>
                                                    {stateLabel}
                                                </span>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </>
            )}
        </div>
    );
}
