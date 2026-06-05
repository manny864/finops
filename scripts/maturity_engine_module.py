import os
import json

base_dir = "/Users/manuelchavez/Documents/FinOpsProyect"

def deploy():
    # 1. Update directivas
    print("Creando directiva...")
    os.makedirs(os.path.join(base_dir, "directivas"), exist_ok=True)
    sop_path = os.path.join(base_dir, "directivas/finops_maturity_SOP.md")
    with open(sop_path, "w") as f:
        f.write("# FinOps Maturity Scoring Engine SOP\\n\\n")
        f.write("## Objetivo\\nGenerar un cálculo de madurez alineado al framework de la FinOps Foundation (Crawl, Walk, Run).\\n\\n")
        f.write("## Restricciones/Casos Borde\\n- Validar siempre `tenantId` en los endpoints.\\n- Renderizar una interfaz que priorice de un vistazo la salud (Overall Health) usando componentes circulares grandes.\\n- Mantener consistencia visual y de theming (dark mode).\\n")

    # 2. Update Sidebar
    print("Actualizando Sidebar.tsx...")
    sidebar_path = os.path.join(base_dir, "src/components/Sidebar.tsx")
    with open(sidebar_path, "r") as f:
        sidebar = f.read()

    if "Madurez FinOps" not in sidebar:
        if "Target" not in sidebar:
            sidebar = sidebar.replace("    LayoutDashboard,", "    LayoutDashboard,\\n    Target,")
        
        sidebar = sidebar.replace(
            "{ href: '/advisor', label: 'Azure Advisor', icon: Lightbulb }",
            "{ href: '/advisor', label: 'Azure Advisor', icon: Lightbulb },\\n                { href: '/overview/maturity', label: 'Madurez FinOps', icon: Target }"
        )
        with open(sidebar_path, "w") as f:
            f.write(sidebar)

    # 3. Create API Endpoint
    print("Creando API...")
    api_dir = os.path.join(base_dir, "src/app/api/intelligence/maturity")
    os.makedirs(api_dir, exist_ok=True)
    with open(os.path.join(api_dir, "route.ts"), "w") as f:
        f.write(""""import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const tenantId = searchParams.get('tenantId');

    if (!tenantId) {
      return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });
    }

    const authHeader = request.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Falta token Bearer de autenticación." }, { status: 401 });
    }

    const token = authHeader.split(" ")[1];
    const decoded = jwt.decode(token) as any;

    if (!decoded || !decoded.tid) {
      return NextResponse.json({ error: "Estructura de token inválida." }, { status: 401 });
    }

    // Mock Scoring Aggregation Function
    const calculateMaturityScore = () => {
      // Logic to calculate based on actual audit data would go here
      // Returning mock data for now
      return {
        overallScore: 58,
        pillars: {
          ResourceCleanup: 45,
          TaggingCompliance: 62,
          CostEfficiency: 68
        }
      };
    };

    const maturityData = calculateMaturityScore();

    return NextResponse.json({ data: maturityData });

  } catch (error: any) {
    console.error("Maturity API Error:", error);
    return NextResponse.json({ error: "Fallo en la validación de madurez." }, { status: 500 });
  }
}
""")

    # 4. Create Frontend UI
    print("Creando UI...")
    ui_dir = os.path.join(base_dir, "src/app/overview/maturity")
    os.makedirs(ui_dir, exist_ok=True)
    with open(os.path.join(ui_dir, "page.tsx"), "w") as f:
        f.write(""""use client";
import React, { useEffect, useState } from 'react';
import { useTenant } from '@/components/TenantProvider';
import { useMsal } from '@azure/msal-react';
import { Target, TrendingUp, AlertTriangle, CheckCircle2 } from 'lucide-react';

export default function MaturityPage() {
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();
    const [loading, setLoading] = useState(false);
    const [scoreData, setScoreData] = useState<any>(null);

    useEffect(() => {
        if (accounts.length === 0 || selectedTenant.id === 'default') return;

        const fetchMaturity = async () => {
            setLoading(true);
            try {
                const tokenResponse = await instance.acquireTokenSilent({
                    scopes: ["User.Read"],
                    account: accounts[0]
                });
                const res = await fetch(`/api/intelligence/maturity?tenantId=${selectedTenant.id}`, {
                    headers: { 'Authorization': `Bearer ${tokenResponse.idToken}` }
                });
                const json = await res.json();
                if (json.data) {
                    setScoreData(json.data);
                }
            } catch (e) {
                console.error(e);
            }
            setLoading(false);
        };
        fetchMaturity();
    }, [selectedTenant, accounts, instance]);

    const getPhaseInfo = (score: number) => {
        if (score < 40) return { label: 'Crawl', color: 'text-red-500', bg: 'bg-red-100 dark:bg-red-900/30 border-red-200 dark:border-red-800' };
        if (score <= 75) return { label: 'Walk', color: 'text-amber-500', bg: 'bg-amber-100 dark:bg-amber-900/30 border-amber-200 dark:border-amber-800' };
        return { label: 'Run', color: 'text-green-500', bg: 'bg-green-100 dark:bg-green-900/30 border-green-200 dark:border-green-800' };
    };

    if (selectedTenant.id === 'default') {
        return (
            <div className="flex flex-col items-center justify-center h-96 bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-800 shadow-sm">
                <span className="text-4xl mb-4">🔐</span>
                <h2 className="text-xl font-bold text-gray-700 dark:text-gray-300">Selecciona un Tenant</h2>
                <p className="text-sm text-gray-500 mt-2">Debes seleccionar una organización para evaluar su madurez.</p>
            </div>
        );
    }

    if (loading || !scoreData) {
        return (
            <div className="flex flex-col items-center justify-center h-96 text-gray-400 animate-pulse">
                Calculando Madurez FinOps...
            </div>
        );
    }

    const phase = getPhaseInfo(scoreData.overallScore);

    return (
        <div className="max-w-6xl mx-auto animate-in fade-in duration-500">
            <div className="mb-8 border-b border-gray-200 dark:border-slate-800 pb-4">
                <h1 className="text-3xl font-extrabold text-gray-900 dark:text-white tracking-tight flex items-center">
                    <Target className="w-8 h-8 mr-3 text-indigo-600 dark:text-indigo-400" />
                    Madurez FinOps
                </h1>
                <p className="text-gray-500 dark:text-gray-400 mt-2">Alineación con el framework de la FinOps Foundation.</p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Overall Score Gauge Section */}
                <div className="lg:col-span-1 bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-gray-200 dark:border-slate-800 p-8 flex flex-col items-center justify-center relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-50 dark:bg-indigo-900/20 rounded-bl-full -z-10"></div>
                    <h2 className="text-lg font-bold text-gray-600 dark:text-gray-400 mb-6 uppercase tracking-wider text-center">Overall Health Score</h2>
                    
                    <div className="relative flex items-center justify-center w-48 h-48">
                        <svg className="absolute inset-0 w-full h-full transform -rotate-90">
                            <circle cx="96" cy="96" r="80" className="stroke-gray-100 dark:stroke-slate-800" strokeWidth="16" fill="none" />
                            <circle cx="96" cy="96" r="80" className="stroke-indigo-600 dark:stroke-indigo-400" strokeWidth="16" fill="none" strokeDasharray="502" strokeDashoffset={502 - (502 * scoreData.overallScore) / 100} strokeLinecap="round" />
                        </svg>
                        <div className="flex flex-col items-center z-10 justify-center">
                            <span className="text-6xl font-black text-indigo-600 dark:text-indigo-400">{scoreData.overallScore}</span>
                            <span className="text-sm font-semibold text-gray-400">/ 100</span>
                        </div>
                    </div>

                    <div className={`mt-8 px-6 py-2 rounded-full border flex items-center font-bold uppercase tracking-widest ${phase.bg} ${phase.color}`}>
                        Fase Actual: {phase.label}
                    </div>
                </div>

                {/* Pillars Breakdown Section */}
                <div className="lg:col-span-2 flex flex-col gap-6">
                    <h3 className="text-xl font-bold text-gray-800 dark:text-gray-200">Desglose por Pilares</h3>
                    
                    {/* Pillar: Limpieza de Recursos */}
                    <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 p-6 transition-all hover:shadow-md">
                        <div className="flex justify-between items-center mb-4">
                            <div className="flex items-center">
                                <AlertTriangle className={`w-5 h-5 mr-3 ${scoreData.pillars.ResourceCleanup < 50 ? 'text-red-500' : 'text-indigo-500'}`} />
                                <div>
                                    <h4 className="font-bold text-gray-900 dark:text-white">Limpieza de Recursos</h4>
                                    <p className="text-xs text-gray-500">Recursos huérfanos, zombies y desasociados.</p>
                                </div>
                            </div>
                            <span className="text-2xl font-black text-gray-700 dark:text-gray-300">{scoreData.pillars.ResourceCleanup}%</span>
                        </div>
                        <div className="w-full bg-gray-200 dark:bg-slate-700 rounded-full h-3">
                            <div className={`h-3 rounded-full ${scoreData.pillars.ResourceCleanup < 50 ? 'bg-red-500' : 'bg-indigo-500'}`} style={{ width: `${scoreData.pillars.ResourceCleanup}%` }}></div>
                        </div>
                    </div>

                    {/* Pillar: Cumplimiento de Etiquetas */}
                    <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 p-6 transition-all hover:shadow-md">
                        <div className="flex justify-between items-center mb-4">
                            <div className="flex items-center">
                                <CheckCircle2 className={`w-5 h-5 mr-3 ${scoreData.pillars.TaggingCompliance < 50 ? 'text-red-500' : 'text-indigo-500'}`} />
                                <div>
                                    <h4 className="font-bold text-gray-900 dark:text-white">Cumplimiento de Etiquetas</h4>
                                    <p className="text-xs text-gray-500">Etiquetado de Cost Center, Owner y Environment.</p>
                                </div>
                            </div>
                            <span className="text-2xl font-black text-gray-700 dark:text-gray-300">{scoreData.pillars.TaggingCompliance}%</span>
                        </div>
                        <div className="w-full bg-gray-200 dark:bg-slate-700 rounded-full h-3">
                            <div className={`h-3 rounded-full ${scoreData.pillars.TaggingCompliance < 50 ? 'bg-red-500' : 'bg-indigo-500'}`} style={{ width: `${scoreData.pillars.TaggingCompliance}%` }}></div>
                        </div>
                    </div>

                    {/* Pillar: Eficiencia de Costos */}
                    <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 p-6 transition-all hover:shadow-md">
                        <div className="flex justify-between items-center mb-4">
                            <div className="flex items-center">
                                <TrendingUp className={`w-5 h-5 mr-3 ${scoreData.pillars.CostEfficiency < 50 ? 'text-red-500' : 'text-indigo-500'}`} />
                                <div>
                                    <h4 className="font-bold text-gray-900 dark:text-white">Eficiencia de Costos</h4>
                                    <p className="text-xs text-gray-500">Rightsizing y planes de ahorro.</p>
                                </div>
                            </div>
                            <span className="text-2xl font-black text-gray-700 dark:text-gray-300">{scoreData.pillars.CostEfficiency}%</span>
                        </div>
                        <div className="w-full bg-gray-200 dark:bg-slate-700 rounded-full h-3">
                            <div className={`h-3 rounded-full ${scoreData.pillars.CostEfficiency < 50 ? 'bg-red-500' : 'bg-indigo-500'}`} style={{ width: `${scoreData.pillars.CostEfficiency}%` }}></div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
""")

    print("Deploy completed.")

if __name__ == "__main__":
    deploy()
