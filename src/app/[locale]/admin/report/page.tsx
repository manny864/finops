"use client";
import React, { useEffect, useState } from 'react';
import { useTenant } from '@/components/TenantProvider';
import { useMsal } from '@azure/msal-react';
import CostPieChart from '@/components/CostPieChart';
import PdfExportButton from '@/components/PdfExportButton';
import { FileText, AlertCircle } from 'lucide-react';
import { isMockTenant } from '@/lib/mockData';


export default function ReportGeneratorPage() {
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();
    
    const [dashboardData, setDashboardData] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    
    const totalSavings = dashboardData.reduce((sum, item) => sum + (item.potentialSavings || 0), 0);

    useEffect(() => {
        if ((accounts.length === 0 && !isMockTenant(selectedTenant?.id || '')) || selectedTenant.id === 'default') return;
        
        const fetchData = async () => {
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
                if (json.auditResults) {
                    const resourceConfig: any = {
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
                    let mappedData: any[] = [];
                    for (const [key, config] of Object.entries(resourceConfig)) {
                        const items = json.auditResults[key] || [];
                        mappedData.push(...items.map((r: any) => ({
                            ...r,
                            type: (config as any).type,
                            issueType: (config as any).issueType,
                            potentialSavings: r.estimatedMonthlyCost || (r.diskSizeGB ? r.diskSizeGB * 0.15 : (r.sizeGB ? r.sizeGB * 0.05 : (config as any).savings))
                        })));
                    }
                    setDashboardData(mappedData);
                }
            } catch (e) {}
            setLoading(false);
        };
        fetchData();
    }, [selectedTenant, accounts, instance]);

    if (selectedTenant.id === 'default') {
        return (
            <div className="flex flex-col items-center justify-center h-96 bg-white rounded-lg border border-gray-200 shadow-sm">
                <span className="text-4xl mb-4">🔐</span>
                <h2 className="text-xl font-bold text-gray-700">Selecciona un Tenant</h2>
                <p className="text-sm text-gray-500 mt-2">Debes seleccionar una organización para exportar el reporte.</p>
            </div>
        );
    }

    const suggestionsMap: Record<string, string> = {
        "Disco sin asociar": "Eliminar discos huérfanos que ya no están atachados a ninguna VM para detener el costo de almacenamiento.",
        "IP Pública sin asignar": "Desasignar y borrar direcciones IP públicas que no estén asociadas a interfaces de red.",
        "Snapshot Antiguo (>90d)": "Archivar o eliminar snapshots con más de 90 días de antigüedad que ya no sean necesarios para recuperación.",
        "Sin Etiquetas FinOps": "Implementar Azure Policy para forzar el etiquetado (ej. CostCenter) en todos los recursos nuevos.",
        "NIC Huérfano": "Eliminar interfaces de red que perdieron su VM asociada para mantener limpio el inventario.",
        "NSG sin asociar": "Auditar y borrar Grupos de Seguridad de Red que no estén protegiendo ninguna subred o NIC.",
        "Plan ASP vacío": "Consolidar aplicaciones o eliminar el App Service Plan si no tiene Web Apps corriendo, ya que cobra por capacidad reservada.",
        "Set vacío": "Eliminar Availability Sets sin máquinas virtuales asociadas.",
        "Pool Vacío": "Destruir SQL Elastic Pools sin bases de datos para evitar cobros de vCores sin uso.",
        "No asignada": "Revisar tablas de ruteo sin subredes asociadas y eliminarlas si son obsoletas.",
        "Sin Backend": "Eliminar Load Balancers que no tengan pools de backend configurados.",
        "Sin Política": "Eliminar WAFs de Front Door que no tengan políticas de seguridad aplicadas.",
        "Sin Endpoints": "Destruir perfiles de Traffic Manager sin endpoints.",
        "Sin Backend IPs": "Apagar o eliminar Application Gateways sin IPs de backend reales.",
        "Red Vacía": "Eliminar Redes Virtuales (VNETs) que no contengan subredes o recursos conectados.",
        "Subred Vacía": "Limpiar subredes sin uso dentro de las VNETs para liberar el espacio de direccionamiento IP.",
        "Sin Subred": "Desasociar y borrar NAT Gateways que no presten servicio a ninguna subred.",
        "Sin Firewall": "Eliminar IP Groups huérfanos que no se usen en reglas de Azure Firewall.",
        "Sin Enlaces": "Borrar Zonas DNS Privadas sin enlaces a redes virtuales (VNet Links).",
        "Desconectado": "Limpiar Private Endpoints que perdieron la conexión a su recurso PaaS destino.",
        "Sin Conexiones": "Eliminar VNet Gateways (VPN/ExpressRoute) sin conexiones activas, ya que tienen un alto costo por hora.",
        "Sin Recursos": "Desactivar planes de protección DDoS que no estén vinculados a ninguna VNET pública para evitar cobros recurrentes fijos.",
        "RG Vacío": "Eliminar Grupos de Recursos vacíos para mejorar la gobernanza y limpieza del entorno.",
        "Desconectada": "Eliminar API Connections sin uso en Logic Apps.",
        "Expirado": "Renovar o eliminar certificados expirados en App Services o Key Vaults."
    };

    const groupedIssues = dashboardData.reduce((acc: any, curr: any) => {
        if (!acc[curr.issue]) {
            acc[curr.issue] = {
                count: 0,
                potentialSavings: 0,
                type: curr.type,
                issueType: curr.issueType
            };
        }
        acc[curr.issue].count += 1;
        acc[curr.issue].potentialSavings += curr.potentialSavings;
        return acc;
    }, {});

    const issuesList = Object.entries(groupedIssues).sort((a: any, b: any) => b[1].potentialSavings - a[1].potentialSavings);

    return (
        <div className="max-w-5xl mx-auto animate-in fade-in duration-500">
            <div className="mb-6 flex flex-col md:flex-row justify-between items-start md:items-end border-b border-gray-200 dark:border-gray-800 pb-4 gap-4">
                <div>
                    <h1 className="text-3xl font-extrabold text-gray-900 dark:text-white tracking-tight flex items-center">
                        <FileText className="w-8 h-8 mr-3 text-indigo-600 dark:text-indigo-400" />
                        Reporte Ejecutivo
                    </h1>
                    <p className="text-gray-500 dark:text-gray-400 mt-2">Genera un documento formal en PDF para las juntas directivas.</p>
                </div>
                <PdfExportButton targetId="pdf-export-area" tenantName={selectedTenant.name} />
            </div>

            {/* Vista Previa del Reporte */}
            <div className="bg-gray-100 dark:bg-slate-800 p-8 rounded-xl border border-gray-200 dark:border-slate-700">
                <div className="mb-4 flex items-center text-sm font-bold text-gray-500 uppercase tracking-wider">
                    <AlertCircle className="w-4 h-4 mr-2" /> Document Preview
                </div>
                
                {/* Contenedor a exportar (Fondo blanco forzado para evitar bugs) */}
                <div id="pdf-export-area" className="bg-white p-8 rounded-lg shadow-lg border border-gray-200 text-gray-900" style={{ width: '100%', minHeight: '800px' }}>
                    <div className="text-center mb-8 border-b border-gray-200 pb-6">
                        <h2 className="text-3xl font-extrabold text-[#0054A6]">FinOps Audit Executive Summary</h2>
                        <p className="text-gray-500 mt-2 text-lg">Organization: {selectedTenant.name}</p>
                    </div>

                    <div className="bg-green-50 border border-green-200 rounded-xl px-8 py-8 flex flex-col items-center justify-center mb-10 shadow-sm mx-auto max-w-xl">
                        <span className="text-sm font-bold text-green-700 uppercase tracking-widest mb-2">Total Monthly Savings Identified</span>
                        <span className="text-6xl font-extrabold text-green-600">
                            {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(totalSavings)}
                        </span>
                        <span className="text-sm text-green-600 mt-2 font-medium">Estimated Projection</span>
                    </div>

                    <div className="max-w-2xl mx-auto mt-12">
                        <h3 className="text-xl font-bold text-gray-800 mb-6 text-center border-b border-gray-100 pb-2">Resource Inefficiencies Distribution</h3>
                        {loading ? (
                            <div className="h-64 flex items-center justify-center text-gray-400 animate-pulse">Calculando gráficas...</div>
                        ) : dashboardData.length > 0 ? (
                            <div className="h-80">
                                <CostPieChart data={dashboardData} onSegmentClick={() => {}} />
                            </div>
                        ) : (
                            <div className="text-center text-gray-500 py-10">Entorno 100% optimizado.</div>
                        )}
                    </div>

                    <div className="mt-16 pt-8 border-t border-gray-200" style={{ pageBreakBefore: issuesList.length > 0 ? "always" : "auto" }}>
                        <h3 className="text-2xl font-extrabold text-[#0054A6] mb-6">Hallazgos y Plan de Remediación</h3>
                        
                        {issuesList.length === 0 ? (
                            <p className="text-gray-500 text-center py-4">No hay hallazgos críticos detectados en este escaneo.</p>
                        ) : (
                            <div className="space-y-6">
                                {issuesList.map(([issueName, data]: any, idx: number) => (
                                    <div key={idx} className="bg-gray-50 border border-gray-100 rounded-lg p-5">
                                        <div className="flex justify-between items-start mb-3 border-b border-gray-200 pb-3">
                                            <div>
                                                <h4 className="text-lg font-bold text-gray-900 flex items-center">
                                                    <span className={`w-3 h-3 rounded-full mr-2 ${data.issueType === 'cost' ? 'bg-red-500' : 'bg-amber-500'}`}></span>
                                                    {issueName}
                                                </h4>
                                                <p className="text-sm text-gray-500 mt-1">
                                                    <span className="font-semibold text-gray-700">{data.count}</span> recurso(s) afectado(s) | Tipo: {data.type}
                                                </p>
                                            </div>
                                            <div className="text-right">
                                                <span className={`text-lg font-extrabold ${data.potentialSavings > 0 ? 'text-green-600' : 'text-gray-400'}`}>
                                                    {data.potentialSavings > 0 ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(data.potentialSavings) : '-'}
                                                </span>
                                                <p className="text-xs text-gray-400 uppercase tracking-widest mt-1">Impacto / Mes</p>
                                            </div>
                                        </div>
                                        <div>
                                            <h5 className="text-sm font-bold text-gray-700 mb-1">Sugerencia de Mejora:</h5>
                                            <p className="text-sm text-gray-600 bg-white p-3 rounded border border-gray-200 shadow-sm leading-relaxed">
                                                {suggestionsMap[issueName] || "Revisar y auditar estos recursos manualmente para determinar si son necesarios en la arquitectura actual."}
                                            </p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
