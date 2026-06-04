import os

base_dir = "/Users/manuelchavez/Documents/FinOpsProyect"

def create_blade():
    path = os.path.join(base_dir, "src/components/dashboard/RightsizingBlade.tsx")
    code = """"use client";
import React, { useState, useEffect } from 'react';
import { useMsal } from '@azure/msal-react';
import { useTenant } from '../TenantProvider';

export default function RightsizingBlade() {
    const { instance, accounts } = useMsal();
    const { selectedTenant } = useTenant();
    const [recommendations, setRecommendations] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (accounts.length === 0 || selectedTenant.id === 'default') return;
        
        const fetchRightsizing = async () => {
            setLoading(true);
            try {
                const tokenResponse = await instance.acquireTokenSilent({
                    scopes: ["User.Read"],
                    account: accounts[0]
                });
                
                const res = await fetch(`/api/audit/rightsizing?tenantId=${selectedTenant.id}`, {
                    headers: { 'Authorization': `Bearer ${tokenResponse.idToken}` }
                });
                const json = await res.json();
                if (json.recommendations) {
                    setRecommendations(json.recommendations);
                }
            } catch (e) {
                console.error("Error fetching rightsizing data:", e);
            }
            setLoading(false);
        };
        fetchRightsizing();
    }, [accounts, instance, selectedTenant.id]);

    if (accounts.length === 0 || selectedTenant.id === 'default') return null;

    return (
        <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-6 mt-6">
            <h3 className="text-lg font-bold text-gray-800 mb-2">Motor de Rightsizing (Ajuste de Tamaño)</h3>
            <p className="text-sm text-gray-500 mb-4">Máquinas virtuales con un pico máximo de CPU inferior al 20% en los últimos 14 días.</p>
            
            {loading ? (
                <div className="h-40 flex items-center justify-center">
                    <div className="text-sm text-gray-400 animate-pulse">Analizando métricas históricas de Azure Monitor...</div>
                </div>
            ) : recommendations.length === 0 ? (
                <div className="text-sm text-green-600 bg-green-50 p-4 rounded-md border border-green-100 flex items-center justify-center text-center">
                    <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd"></path></svg>
                    Excelente. Ninguna VM está severamente subutilizada en este momento.
                </div>
            ) : (
                <div className="overflow-x-auto bg-white rounded-lg border border-gray-200 shadow-sm">
                    <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                            <tr>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Máquina Virtual</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">SKU Actual</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">SKU Sugerido (Downgrade)</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Pico Máximo CPU (14d)</th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                            {recommendations.map((rec, idx) => (
                                <tr key={idx} className="hover:bg-gray-50 transition-colors">
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{rec.vmName}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{rec.currentSku}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-[#0054A6]">{rec.suggestedSku}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                        <span className="px-2 py-1 bg-yellow-100 text-yellow-800 rounded-full text-xs font-semibold">
                                            {rec.maxCpuPeak.toFixed(1)}%
                                        </span>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
"""
    with open(path, "w") as f:
        f.write(code)

def update_page():
    path = os.path.join(base_dir, "src/app/page.tsx")
    with open(path, "r") as f:
        content = f.read()

    if "import RightsizingBlade" not in content:
        content = content.replace(
            'import BudgetBurnChart from "@/components/dashboard/BudgetBurnChart";',
            'import BudgetBurnChart from "@/components/dashboard/BudgetBurnChart";\\nimport RightsizingBlade from "@/components/dashboard/RightsizingBlade";'
        )

    if "<RightsizingBlade />" not in content:
        content = content.replace(
            "<BudgetBurnChart />\\n        </div>",
            "<BudgetBurnChart />\\n        <RightsizingBlade />\\n        </div>"
        )
        
    with open(path, "w") as f:
        f.write(content)

def update_sop():
    path = os.path.join(base_dir, "directivas/rightsizing_SOP.md")
    with open(path, "a") as f:
        f.write("- **UI**: `RightsizingBlade.tsx` despliega el listado con sugerencias de downgrade de la API de métricas.\\n")

if __name__ == "__main__":
    create_blade()
    update_page()
    update_sop()
    print("UI Deploy completado.")
