const fs = require('fs');
const path = require('path');

const base_dir = '/Users/manuelchavez/Documents/FinOpsProyect';

// 1. CostPieChart.tsx
const pieChartContent = `"use client";
import React, { useState } from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend, Sector } from 'recharts';

export default function CostPieChart({ data, onSegmentClick }: { data: any[], onSegmentClick?: (category: string | null) => void }) {
    const [activeIndex, setActiveIndex] = useState<number | null>(null);

    if (!data || data.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-64 text-gray-400">
                <svg className="w-12 h-12 mb-2 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"></path></svg>
                <p className="font-medium">Aún no hay datos de costos para graficar.</p>
            </div>
        );
    }

    const grouped = data.reduce((acc: any, item: any) => {
        if (item.issueType !== 'cost' || item.potentialSavings <= 0) return acc;
        if (!acc[item.type]) acc[item.type] = 0;
        acc[item.type] += item.potentialSavings;
        return acc;
    }, {});

    const chartData = Object.keys(grouped).map(key => ({
        name: key,
        value: Number(grouped[key].toFixed(2))
    })).filter(d => d.value > 0).sort((a,b) => b.value - a.value);

    const COLORS = ['#0054A6', '#F2A900', '#10B981', '#EF4444', '#8B5CF6', '#F43F5E', '#0EA5E9', '#F59E0B'];

    if (chartData.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-64 text-gray-400">
                <p className="font-medium">El entorno está 100% optimizado en costos.</p>
            </div>
        );
    }

    const handleClick = (entry: any, index: number) => {
        if (activeIndex === index) {
            setActiveIndex(null);
            if (onSegmentClick) onSegmentClick(null);
        } else {
            setActiveIndex(index);
            if (onSegmentClick) onSegmentClick(entry.name);
        }
    };

    const renderActiveShape = (props: any) => {
      const { cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill } = props;
      return (
        <g>
          <Sector
            cx={cx}
            cy={cy}
            innerRadius={innerRadius}
            outerRadius={outerRadius + 8}
            startAngle={startAngle}
            endAngle={endAngle}
            fill={fill}
          />
        </g>
      );
    };

    return (
        <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                    <Pie
                        activeIndex={activeIndex !== null ? activeIndex : undefined}
                        activeShape={renderActiveShape}
                        data={chartData}
                        cx="50%"
                        cy="50%"
                        innerRadius={65}
                        outerRadius={95}
                        paddingAngle={5}
                        dataKey="value"
                        stroke="none"
                        onClick={handleClick}
                        className="cursor-pointer focus:outline-none"
                    >
                        {chartData.map((entry, index) => (
                            <Cell 
                                key={`cell-${index}`} 
                                fill={COLORS[index % COLORS.length]} 
                                opacity={activeIndex === null || activeIndex === index ? 1 : 0.3}
                            />
                        ))}
                    </Pie>
                    <Tooltip 
                        formatter={(value: number) => [`$${value} USD`, 'Ahorro Potencial']}
                        contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                    />
                    <Legend wrapperStyle={{ fontSize: '12px', fontWeight: 600, paddingTop: '10px' }} />
                </PieChart>
            </ResponsiveContainer>
        </div>
    );
}`;
fs.writeFileSync(path.join(base_dir, 'src', 'components', 'CostPieChart.tsx'), pieChartContent);

// 2. page.tsx
const pageContent = `"use client";
import { useContext, useEffect, useState } from 'react';
import { TabContext } from '@/components/ClientShell';
import { useMsal } from '@azure/msal-react';
import { useTenant } from '@/components/TenantProvider';
import ZombieResourcesTable from "@/components/ZombieResourcesTable";
import TagManager from "@/components/TagManager";
import CostPieChart from "@/components/CostPieChart";

export default function Home() {
  const { activeTab } = useContext(TabContext);
  const { instance, accounts } = useMsal();
  const { selectedTenant } = useTenant();
  
  const [dashboardData, setDashboardData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  useEffect(() => {
      if (activeTab !== 'dashboard' || accounts.length === 0 || selectedTenant.id === 'default') return;
      
      const fetchData = async () => {
          setLoading(true);
          try {
              const tokenResponse = await instance.acquireTokenSilent({
                  scopes: ["User.Read"],
                  account: accounts[0]
              });
              const res = await fetch(\`/api/audit/full?tenantId=${selectedTenant.id}\`, {
                  headers: { 'Authorization': \`Bearer ${tokenResponse.idToken}\` }
              });
              const json = await res.json();
              if (json.auditResults) {
                  const allItems = Object.values(json.auditResults).flat().map((item: any) => ({
                      ...item,
                      issueType: 'cost',
                      potentialSavings: item.diskSizeGB ? item.diskSizeGB * 0.15 : (item.sizeGB ? item.sizeGB * 0.05 : 15.0),
                      type: item.type ? item.type.split("/").pop() : 'Resource'
                  }));
                  setDashboardData(allItems);
              }
          } catch (e) {}
          setLoading(false);
      };
      fetchData();
  }, [activeTab, selectedTenant, accounts, instance]);

  if (activeTab === 'audit') {
      return (
          <div className="animate-in fade-in duration-300">
              <div className="mb-6">
                  <h2 className="text-2xl font-bold text-gray-900">Auditoría Completa FinOps</h2>
                  <p className="text-sm text-gray-500 mt-1">Motor Omni-Scan: Detección y Remediación de 25 tipos de recursos huérfanos.</p>
              </div>
              <ZombieResourcesTable />
          </div>
      );
  }

  if (activeTab === 'tags') {
      return <TagManager />;
  }

  if (activeTab === 'powerbi' || activeTab === 'config') {
      return (
          <div className="flex flex-col items-center justify-center h-96 bg-white rounded-lg border border-gray-200 shadow-sm animate-in fade-in">
              <span className="text-6xl mb-4">🚧</span>
              <h2 className="text-xl font-bold text-gray-700">Módulo en Construcción</h2>
              <p className="text-sm text-gray-500 mt-2">La sección de {activeTab === 'powerbi' ? 'Reportes Power BI' : 'Configuración'} estará disponible en la próxima fase.</p>
          </div>
      );
  }

  return (
    <div className="flex flex-col gap-8 animate-in fade-in duration-500">
      <div className="flex justify-between items-end border-b border-gray-200 pb-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard General</h1>
          <p className="text-sm text-gray-500 mt-1">Visión global de rendimiento y eficiencia en la nube.</p>
        </div>
      </div>
      
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-6 flex flex-col">
             <h3 className="text-lg font-bold text-gray-800 mb-1">Distribución de Fugas Financieras</h3>
             <p className="text-xs text-gray-500 mb-4">Haz clic en un segmento para ver los recursos afectados.</p>
             {loading ? (
                 <div className="flex-1 flex items-center justify-center text-gray-400 animate-pulse">Calculando métricas...</div>
             ) : (
                 <CostPieChart data={dashboardData} onSegmentClick={(cat) => setSelectedCategory(cat)} />
             )}
        </div>
        <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-6">
             <h3 className="text-lg font-bold text-gray-800 mb-4">Estado de Gobernanza</h3>
             <div className="h-64 flex flex-col items-center justify-center text-gray-400 bg-gray-50 rounded-lg border border-dashed border-gray-300">
                 <p className="text-sm font-medium">Score de Seguridad Financiera</p>
                 <span className="text-4xl font-bold text-green-500 mt-2">En proceso...</span>
                 <p className="text-xs text-gray-400 mt-2 text-center px-8">Dirígete a \"Gestión de Etiquetas\" para visualizar el compliance score.</p>
             </div>
        </div>
      </div>

      {selectedCategory && (
          <div className="animate-in slide-in-from-bottom-4 duration-500 mt-4">
              <div className="flex items-center justify-between mb-4">
                  <h3 className="text-xl font-bold text-gray-800">
                      Recursos Afectados: <span className="text-[#0054A6]">{selectedCategory}</span>
                  </h3>
                  <button onClick={() => setSelectedCategory(null)} className="text-sm text-gray-500 hover:text-gray-800 transition-colors">
                      ✕ Limpiar Filtro
                  </button>
              </div>
              <ZombieResourcesTable forceFilterType={selectedCategory} />
          </div>
      )}
    </div>
  );
}`;
fs.writeFileSync(path.join(base_dir, 'src', 'app', 'page.tsx'), pageContent);

// 3. TagManager.tsx
const tagManagerContent = `"use client";
import React, { useEffect, useState } from 'react';
import { useTenant } from './TenantProvider';
import { useMsal } from '@azure/msal-react';

export default function TagManager() {
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();
    const [policies, setPolicies] = useState<any[]>([]);
    const [newTag, setNewTag] = useState('');
    const [loading, setLoading] = useState(false);
    
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [nonCompliantResources, setNonCompliantResources] = useState<any[]>([]);
    const [complianceScore, setComplianceScore] = useState<number | null>(null);

    const fetchPolicies = async () => {
        if (selectedTenant.id === 'default') return;
        setLoading(true);
        try {
            const res = await fetch(\`/api/tags?tenantId=${selectedTenant.id}\`);
            const data = await res.json();
            if (data.policies) setPolicies(data.policies);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchPolicies();
    }, [selectedTenant]);

    useEffect(() => {
        const analyzeCompliance = async () => {
            if (policies.length === 0 || accounts.length === 0 || selectedTenant.id === 'default') {
                setComplianceScore(policies.length === 0 ? 100 : null);
                setNonCompliantResources([]);
                return;
            }
            
            setIsAnalyzing(true);
            try {
                const tokenResponse = await instance.acquireTokenSilent({
                    scopes: ["User.Read"],
                    account: accounts[0]
                });
                
                const res = await fetch(\`/api/audit/full?tenantId=${selectedTenant.id}\`, {
                    headers: { 'Authorization': \`Bearer ${tokenResponse.idToken}\` }
                });
                const json = await res.json();
                
                if (json.auditResults) {
                    const allItems = Object.values(json.auditResults).flat();
                    const requiredKeys = policies.filter(p => p.required).map(p => p.tag_key.toLowerCase());
                    
                    let compliantCount = 0;
                    let nonCompliant: any[] = [];

                    allItems.forEach((item: any) => {
                        const itemTags = item.tags || {};
                        const itemTagKeys = Object.keys(itemTags).map(k => k.toLowerCase());
                        
                        const missingTags = requiredKeys.filter(reqKey => !itemTagKeys.includes(reqKey));
                        
                        if (missingTags.length === 0) {
                            compliantCount++;
                        } else {
                            nonCompliant.push({
                                ...item,
                                missingTags
                            });
                        }
                    });

                    const total = allItems.length;
                    const score = total === 0 ? 100 : Math.round((compliantCount / total) * 100);
                    
                    const uniqueNonCompliant = Array.from(new Map(nonCompliant.map(item => [item.id, item])).values());
                    
                    setComplianceScore(score);
                    setNonCompliantResources(uniqueNonCompliant);
                }
            } catch (e) {
                console.error("Error analyzing compliance", e);
            }
            setIsAnalyzing(false);
        };
        
        analyzeCompliance();
    }, [policies, selectedTenant, accounts, instance]);

    const addPolicy = async () => {
        if (!newTag.trim() || selectedTenant.id === 'default') return;
        try {
            await fetch('/api/tags', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tenantId: selectedTenant.id, tagKey: newTag.trim(), required: true })
            });
            setNewTag('');
            fetchPolicies();
        } catch (e) {
            console.error(e);
        }
    };

    const deletePolicy = async (id: number) => {
        try {
            await fetch('/api/tags', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id })
            });
            fetchPolicies();
        } catch (e) {
            console.error(e);
        }
    };

    if (selectedTenant.id === 'default') {
        return <div className="bg-white rounded-lg p-12 text-center border border-gray-200 text-gray-500 shadow-sm">Selecciona un cliente en la cabecera para gestionar sus políticas de etiquetado.</div>;
    }

    return (
        <div className="flex flex-col gap-6 animate-in fade-in duration-500">
            <div className="bg-white p-8 rounded-lg shadow-sm border border-gray-200">
                <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6 mb-8">
                    <div className="flex items-center space-x-4">
                        <div className="p-3 bg-blue-50 text-[#0054A6] rounded-lg">
                            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z"></path></svg>
                        </div>
                        <div>
                            <h3 className="text-xl font-bold text-gray-800">Gobernanza de Etiquetas (Tags)</h3>
                            <p className="text-sm text-gray-500">Fuerza el cumplimiento de etiquetas para el tenant: <span className="font-semibold text-gray-700">{selectedTenant.name}</span></p>
                        </div>
                    </div>

                    <div className="flex items-center gap-4 bg-gray-50 px-6 py-4 rounded-xl border border-gray-100">
                        <div className="flex flex-col items-end">
                            <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">Compliance Score</span>
                            {isAnalyzing ? (
                                <span className="text-sm font-medium text-blue-500 animate-pulse mt-1">Analizando Azure...</span>
                            ) : (
                                <span className="text-sm font-medium text-gray-600 mt-1">
                                    {nonCompliantResources.length} infracciones
                                </span>
                            )}
                        </div>
                        <div className={`w-16 h-16 rounded-full flex items-center justify-center border-4 ${complianceScore === null ? 'border-gray-200' : complianceScore >= 90 ? 'border-green-500 text-green-600' : complianceScore >= 70 ? 'border-amber-400 text-amber-500' : 'border-red-500 text-red-600'}`}>
                            <span className="text-xl font-bold">
                                {complianceScore === null ? '-' : `${complianceScore}%`}
                            </span>
                        </div>
                    </div>
                </div>
                
                <div className="flex space-x-2 mb-6 bg-gray-50 p-4 rounded-lg border border-gray-100">
                    <input 
                        type="text" 
                        value={newTag} 
                        onChange={e => setNewTag(e.target.value)} 
                        placeholder="Ej. CostCenter, Environment..." 
                        className="flex-1 border border-gray-300 rounded-md px-4 py-2 text-sm focus:ring-[#0054A6] focus:border-[#0054A6] shadow-sm"
                    />
                    <button onClick={addPolicy} className="bg-[#0054A6] text-white px-6 py-2 rounded-md text-sm font-semibold hover:bg-blue-800 transition-colors shadow-sm">
                        + Añadir Regla Obligatoria
                    </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {loading ? <div className="text-sm text-gray-400 animate-pulse">Cargando políticas...</div> : 
                     policies.length === 0 ? <div className="text-sm text-gray-400">No hay reglas estrictas.</div> : 
                     policies.map(p => (
                        <div key={p.id} className="flex justify-between items-center bg-white px-4 py-3 rounded-lg border border-gray-200 shadow-sm hover:border-blue-200 transition-colors group">
                            <div className="flex items-center space-x-3">
                                <span className="bg-red-50 text-red-700 border border-red-100 text-[9px] font-bold px-2 py-0.5 rounded tracking-wider">REQUERIDO</span>
                                <span className="text-sm font-mono font-bold text-gray-800 truncate">{p.tag_key}</span>
                            </div>
                            <button onClick={() => deletePolicy(p.id)} className="text-gray-300 hover:text-red-600 transition-colors">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                            </button>
                        </div>
                    ))}
                </div>
            </div>

            <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-200 bg-gray-50 flex justify-between items-center">
                    <h3 className="text-sm font-bold text-gray-800">Recursos No Conformes (Infracciones)</h3>
                    {isAnalyzing && <span className="text-xs text-blue-600 font-medium animate-pulse">Escaneando infraestructura...</span>}
                </div>
                
                {!isAnalyzing && nonCompliantResources.length === 0 ? (
                    <div className="p-12 text-center flex flex-col items-center">
                        <div className="w-16 h-16 bg-green-50 text-green-500 rounded-full flex items-center justify-center mb-4">
                            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
                        </div>
                        <h4 className="text-lg font-bold text-gray-800">¡Infraestructura Impecable!</h4>
                        <p className="text-sm text-gray-500 mt-1">Todos los recursos cumplen con las políticas de etiquetado requeridas.</p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="bg-white text-xs font-bold text-gray-500 uppercase tracking-wider border-b border-gray-200">
                                    <th className="p-4">Recurso</th>
                                    <th className="p-4">Tipo</th>
                                    <th className="p-4">Etiquetas Faltantes</th>
                                </tr>
                            </thead>
                            <tbody>
                                {nonCompliantResources.map((item, i) => (
                                    <tr key={`item-${i}`} className="border-b border-gray-100 hover:bg-red-50/30 transition-colors">
                                        <td className="p-4 text-sm font-semibold text-gray-800">
                                            {item.name || item.resourceName || 'Unknown'}
                                        </td>
                                        <td className="p-4 text-xs font-mono text-gray-500">
                                            {item.type ? item.type.split("/").pop() : 'Resource'}
                                        </td>
                                        <td className="p-4">
                                            <div className="flex flex-wrap gap-2">
                                                {item.missingTags.map((tag: string, idx: number) => (
                                                    <span key={idx} className="bg-red-100 text-red-700 border border-red-200 text-xs font-medium px-2 py-0.5 rounded shadow-sm">
                                                        {tag}
                                                    </span>
                                                ))}
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}`;
fs.writeFileSync(path.join(base_dir, 'src', 'components', 'TagManager.tsx'), tagManagerContent);

// 4. ZombieResourcesTable.tsx
const zrPath = path.join(base_dir, 'src', 'components', 'ZombieResourcesTable.tsx');
let zrContent = fs.readFileSync(zrPath, 'utf-8');
zrContent = zrContent.replace("export default function ZombieResourcesTable() {", "export default function ZombieResourcesTable({ forceFilterType }: { forceFilterType?: string }) {");
zrContent = zrContent.replace(
"        setData(allMappedData);", 
`        if (forceFilterType) {
            allMappedData = allMappedData.filter(d => d.type === forceFilterType);
        }
        setData(allMappedData);`
);
zrContent = zrContent.replace("[accounts, instance, selectedSub, selectedTenant]", "[accounts, instance, selectedSub, selectedTenant, forceFilterType]");
fs.writeFileSync(zrPath, zrContent);

console.log("Phase 15 executed successfully!");
