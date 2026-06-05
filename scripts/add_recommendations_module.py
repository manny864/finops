import os

base_dir = "/Users/manuelchavez/Documents/FinOpsProyect"

def deploy():
    print("Actualizando src/app/admin/report/page.tsx...")
    page_path = os.path.join(base_dir, "src/app/admin/report/page.tsx")
    with open(page_path, "r") as f:
        content = f.read()

    # Añadir el diccionario de sugerencias y la agrupación justo antes del return
    if "suggestionsMap" not in content:
        suggestions_logic = """
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

    return ("""
        
        content = content.replace("    return (", suggestions_logic, 1)
        
        pie_chart_section = """                        ) : (
                            <div className="text-center text-gray-500 py-10">Entorno 100% optimizado.</div>
                        )}
                    </div>"""
                    
        recommendations_section = """                        ) : (
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
                    </div>"""
                    
        content = content.replace(pie_chart_section, recommendations_section)
        
        with open(page_path, "w") as f:
            f.write(content)

    print("Deploy completed.")

if __name__ == "__main__":
    deploy()
