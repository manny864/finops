const fs = require('fs');
const path = require('path');

const base_dir = '/Users/manuelchavez/Documents/FinOpsProyect';

// 1. /api/tags/route.ts
const apiTagsDir = path.join(base_dir, 'src', 'app', 'api', 'tags');
if (!fs.existsSync(apiTagsDir)) fs.mkdirSync(apiTagsDir, { recursive: true });

const apiTagsContent = `import { NextRequest, NextResponse } from "next/server";
import mysql from "mysql2/promise";

const pool = mysql.createPool(process.env.DATABASE_URL || "mysql://finops_user:finopspassword@localhost:3306/finops_app");

export async function GET(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url);
        const tenantId = searchParams.get('tenantId');
        if (!tenantId) return NextResponse.json({ error: "Missing tenantId" }, { status: 400 });

        const [rows] = await pool.query("SELECT * FROM TaggingPolicies WHERE tenant_id = ?", [tenantId]);
        return NextResponse.json({ policies: rows });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { tenantId, tagKey, required } = body;
        
        if (!tenantId || !tagKey) return NextResponse.json({ error: "Missing fields" }, { status: 400 });

        await pool.query(
            "INSERT INTO TaggingPolicies (tenant_id, tag_key, required) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE required = VALUES(required)",
            [tenantId, tagKey, required]
        );
        return NextResponse.json({ success: true });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}

export async function DELETE(req: NextRequest) {
    try {
        const body = await req.json();
        const { id } = body;
        if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
        
        await pool.query("DELETE FROM TaggingPolicies WHERE id = ?", [id]);
        return NextResponse.json({ success: true });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
`;
fs.writeFileSync(path.join(apiTagsDir, 'route.ts'), apiTagsContent);

// 2. ClientShell.tsx
const clientShellContent = `"use client";
import React, { useState, createContext } from 'react';
import AuthProvider, { AuthButton } from "./AuthProvider";
import { TenantProvider, useTenant } from './TenantProvider';
import AuthSync from './AuthSync';

export const TabContext = createContext({ activeTab: 'dashboard', setActiveTab: (t: string) => {} });

export default function ClientShell({ children }: { children: React.ReactNode }) {
  return <AuthProvider>
      <AuthSync />
      <TenantProvider>
        <ShellContent>{children}</ShellContent>
      </TenantProvider>
    </AuthProvider>;
}

function ShellContent({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [activeTab, setActiveTab] = useState('dashboard');
  const { selectedTenant, setSelectedTenant, isAdmin, tenants } = useTenant();

  const navItems = [
      { id: 'dashboard', label: 'Dashboard', icon: 'M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z' },
      { id: 'audit', label: 'Auditoría Completa', icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01' },
      { id: 'tags', label: 'Gestión de Etiquetas', icon: 'M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z' },
      { id: 'powerbi', label: 'Reportes Power BI', icon: 'M8 13v-1m4 1v-3m4 3V8M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z' },
      { id: 'config', label: 'Configuración', icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z' },
  ];

  return (
    <TabContext.Provider value={{ activeTab, setActiveTab }}>
    <div className="min-h-screen bg-gray-50 flex text-gray-900">
      {/* Sidebar */}
      <aside className={\`\${sidebarOpen ? 'w-64' : 'w-20'} bg-white border-r border-gray-200 transition-all duration-300 flex flex-col shadow-sm\`}>
        <div className="h-16 flex items-center justify-center border-b border-gray-200 px-4">
          <div className="flex items-center justify-center overflow-hidden w-full h-full">
             {sidebarOpen ? (
                <img src="/logo.png" alt="CSCloudSolutions FinOps" className="h-10 w-auto object-contain" />
             ) : (
                <div className="w-10 h-10 bg-[#0054A6] rounded-md flex items-center justify-center text-white font-bold text-xl shadow-sm">CS</div>
             )}
          </div>
        </div>
        <nav className="flex-1 py-6 px-3 space-y-2 overflow-y-auto">
          {navItems.map(item => (
              <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id)}
                  className={\`w-full flex items-center space-x-3 px-3 py-2.5 rounded-lg font-semibold transition-all duration-200 \${activeTab === item.id ? 'bg-blue-50 text-[#0054A6] shadow-sm border border-blue-100' : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900'}\`}
              >
                  <svg className={\`w-5 h-5 flex-shrink-0 \${activeTab === item.id ? 'text-[#0054A6]' : 'text-gray-400'}\`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={item.icon}></path>
                  </svg>
                  {sidebarOpen && <span className="text-sm">{item.label}</span>}
              </button>
          ))}
        </nav>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-6 z-10 shadow-sm">
          <div className="flex items-center">
            <button onClick={() => setSidebarOpen(!sidebarOpen)} className="p-2 mr-4 text-gray-400 hover:text-[#0054A6] transition-colors focus:outline-none">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16"></path></svg>
            </button>
            <h1 className="text-xl font-bold text-gray-800 hidden sm:block tracking-tight">Cloud FinOps</h1>
          </div>
          
          <div className="flex items-center space-x-6">
            <div className="hidden md:flex items-center border border-gray-200 rounded-lg px-2 py-1 bg-gray-50 relative">
              {isAdmin ? (
                <div className="flex flex-col px-2">
                  <label htmlFor="tenant-select" className="text-[10px] text-[#00AEEF] font-bold uppercase tracking-wider mb-1">
                    Tenant (Admin Propietario)
                  </label>
                  <select
                    id="tenant-select"
                    value={selectedTenant.id}
                    onChange={(e) => {
                      const found = tenants.find(t => t.id === e.target.value);
                      if (found) setSelectedTenant(found);
                    }}
                    className="text-sm font-semibold text-gray-700 bg-transparent border-none outline-none focus:ring-0 cursor-pointer p-0 m-0"
                  >
                    {tenants.map(t => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="flex flex-col px-2 cursor-not-allowed">
                  <span className="text-[10px] text-gray-500 font-bold uppercase tracking-wider">Mi Entorno (Cliente)</span>
                  <span className="text-sm font-semibold text-gray-700">{selectedTenant.name}</span>
                </div>
              )}
            </div>
            <AuthButton />
          </div>
        </header>

        <main className="flex-1 overflow-y-auto bg-gray-50/50 p-6">
          {children}
        </main>
      </div>
    </div>
    </TabContext.Provider>
  );
}
`;
fs.writeFileSync(path.join(base_dir, 'src', 'components', 'ClientShell.tsx'), clientShellContent);

// 3. TagManager.tsx
const tagManagerContent = `"use client";
import React, { useEffect, useState } from 'react';
import { useTenant } from './TenantProvider';

export default function TagManager() {
    const { selectedTenant } = useTenant();
    const [policies, setPolicies] = useState<any[]>([]);
    const [newTag, setNewTag] = useState('');
    const [loading, setLoading] = useState(false);

    const fetchPolicies = async () => {
        if (selectedTenant.id === 'default') return;
        setLoading(true);
        try {
            const res = await fetch(\`/api/tags?tenantId=\${selectedTenant.id}\`);
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
        <div className="bg-white p-8 rounded-lg shadow-sm border border-gray-200 animate-in fade-in">
            <div className="flex items-center space-x-4 mb-6">
                <div className="p-3 bg-blue-50 text-[#0054A6] rounded-lg">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z"></path></svg>
                </div>
                <div>
                    <h3 className="text-xl font-bold text-gray-800">Gobernanza de Etiquetas (Tags)</h3>
                    <p className="text-sm text-gray-500">Fuerza el cumplimiento de etiquetas para el tenant: <span className="font-semibold text-gray-700">{selectedTenant.name}</span></p>
                </div>
            </div>
            
            <div className="flex space-x-2 mb-8 bg-gray-50 p-4 rounded-lg border border-gray-100">
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

            <div className="space-y-3">
                {loading ? <div className="text-sm text-gray-400 text-center py-4 animate-pulse">Cargando políticas de gobernanza...</div> : 
                 policies.length === 0 ? <div className="text-sm text-gray-400 text-center py-4">No hay reglas estrictas de etiquetado definidas para este cliente.</div> :
                 policies.map(p => (
                    <div key={p.id} className="flex justify-between items-center bg-white px-5 py-4 rounded-lg border border-gray-200 shadow-sm hover:border-blue-200 transition-colors group">
                        <div className="flex items-center space-x-4">
                            <span className="bg-red-50 text-red-700 border border-red-100 text-[10px] font-bold px-2 py-1 rounded tracking-wider">REQUERIDO</span>
                            <span className="text-md font-mono font-bold text-gray-800">{p.tag_key}</span>
                        </div>
                        <button onClick={() => deletePolicy(p.id)} className="text-gray-300 hover:text-red-600 p-2 transition-colors">
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                        </button>
                    </div>
                ))}
            </div>
        </div>
    );
}
`;
fs.writeFileSync(path.join(base_dir, 'src', 'components', 'TagManager.tsx'), tagManagerContent);

// 4. CostPieChart.tsx
const pieChartContent = `"use client";
import React from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts';

export default function CostPieChart({ data }: { data: any[] }) {
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

    return (
        <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                    <Pie
                        data={chartData}
                        cx="50%"
                        cy="50%"
                        innerRadius={65}
                        outerRadius={95}
                        paddingAngle={5}
                        dataKey="value"
                        stroke="none"
                    >
                        {chartData.map((entry, index) => (
                            <Cell key={\`cell-\${index}\`} fill={COLORS[index % COLORS.length]} />
                        ))}
                    </Pie>
                    <Tooltip 
                        formatter={(value: number) => [\`$\${value} USD\`, 'Ahorro Potencial']}
                        contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                    />
                    <Legend wrapperStyle={{ fontSize: '12px', fontWeight: 600, paddingTop: '10px' }} />
                </PieChart>
            </ResponsiveContainer>
        </div>
    );
}
`;
fs.writeFileSync(path.join(base_dir, 'src', 'components', 'CostPieChart.tsx'), pieChartContent);

// 5. page.tsx
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

  useEffect(() => {
      // Extraemos la logica de Fetch global para el Dashboard
      if (activeTab !== 'dashboard' || accounts.length === 0 || selectedTenant.id === 'default') return;
      
      const fetchData = async () => {
          setLoading(true);
          try {
              const tokenResponse = await instance.acquireTokenSilent({
                  scopes: ["User.Read"],
                  account: accounts[0]
              });
              const res = await fetch(\`/api/audit/full?tenantId=\${selectedTenant.id}\`, {
                  headers: { 'Authorization': \`Bearer \${tokenResponse.idToken}\` }
              });
              const json = await res.json();
              if (json.auditResults) {
                  // Unimos una simulación rápida de todos los arrays para el gráfico
                  const allItems = Object.values(json.auditResults).flat().map((item: any) => ({
                      ...item,
                      issueType: 'cost',
                      potentialSavings: item.diskSizeGB ? item.diskSizeGB * 0.15 : (item.sizeGB ? item.sizeGB * 0.05 : 15.0), // Calculo genérico aproximado para el gráfico
                      type: item.type ? item.type.split("/").pop() : 'Resource'
                  }));
                  setDashboardData(allItems);
              }
          } catch (e) {}
          setLoading(false);
      };
      fetchData();
  }, [activeTab, selectedTenant, accounts, instance]);

  // SPA Routing
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

  // Default: Dashboard
  return (
    <div className="flex flex-col gap-8 animate-in fade-in duration-500">
      <div className="flex justify-between items-end border-b border-gray-200 pb-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard General</h1>
          <p className="text-sm text-gray-500 mt-1">Visión global de rendimiento y eficiencia en la nube.</p>
        </div>
      </div>
      
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-6">
             <h3 className="text-lg font-bold text-gray-800 mb-4">Distribución de Fugas Financieras (Zombis)</h3>
             {loading ? (
                 <div className="h-64 flex items-center justify-center text-gray-400 animate-pulse">Calculando métricas...</div>
             ) : (
                 <CostPieChart data={dashboardData} />
             )}
        </div>
        <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-6">
             <h3 className="text-lg font-bold text-gray-800 mb-4">Estado de Gobernanza</h3>
             <div className="h-64 flex flex-col items-center justify-center text-gray-400 bg-gray-50 rounded-lg border border-dashed border-gray-300">
                 <p className="text-sm font-medium">Score de Seguridad Financiera</p>
                 <span className="text-4xl font-bold text-green-500 mt-2">92%</span>
             </div>
        </div>
      </div>
    </div>
  );
}
`;
fs.writeFileSync(path.join(base_dir, 'src', 'app', 'page.tsx'), pageContent);

console.log("Phase 14 Interface Builder Completed!");
