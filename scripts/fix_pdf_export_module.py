import os

base_dir = "/Users/manuelchavez/Documents/FinOpsProyect"

def deploy():
    # 1. Update directivas
    sop_path = os.path.join(base_dir, "directivas/pdf_export_SOP.md")
    with open(sop_path, "w") as f:
        f.write("# PDF Export SOP\\n\\n")
        f.write("- **Restricciones/Casos Borde (Tailwind v4 vs html2canvas)**: Nota: No usar `html2canvas` en proyectos con Tailwind v4. Causa el error `Attempting to parse an unsupported color function \"lab\"` porque Tailwind v4 renderiza colores en formatos modernos (oklch/lab) que html2canvas no soporta. En su lugar, usar `html-to-image`.\\n")
        f.write("- **Arquitectura de Reportes**: El generador de reportes se aisló en su propia vista `/admin/report` bajo Administración para no contaminar el Dashboard principal, permitiendo generar vistas pre-estilizadas específicamente para el layout A4 del PDF.\\n")

    # 2. Update PdfExportButton.tsx to use html-to-image
    comp_path = os.path.join(base_dir, "src/components/PdfExportButton.tsx")
    with open(comp_path, "w") as f:
        f.write(""""use client";
import React, { useState } from 'react';
import { FileDown, Loader2 } from 'lucide-react';
import { toPng } from 'html-to-image';
import jsPDF from 'jspdf';
import { toast } from 'sonner';
import { useActionLogStore } from '@/store/actionLogStore';

interface PdfExportButtonProps {
    targetId: string;
    tenantName: string;
}

export default function PdfExportButton({ targetId, tenantName }: PdfExportButtonProps) {
    const [loading, setLoading] = useState(false);
    const { addAction } = useActionLogStore();

    const handleExport = async () => {
        setLoading(true);
        try {
            const element = document.getElementById(targetId);
            if (!element) throw new Error("Área de exportación no encontrada en el DOM.");

            // Usar html-to-image en lugar de html2canvas para soportar Tailwind V4 (lab/oklch)
            const imgData = await toPng(element, { 
                backgroundColor: '#ffffff',
                pixelRatio: 2 // Mayor calidad
            });

            const pdf = new jsPDF({
                orientation: 'portrait',
                unit: 'mm',
                format: 'a4'
            });

            // Añadir el Header corporativo
            pdf.setFontSize(16);
            pdf.setFont("helvetica", "bold");
            pdf.setTextColor(0, 84, 166); // Color Corporativo #0054A6
            pdf.text('CSCloudSolutions - FinOps Executive Report', 15, 20);
            
            pdf.setFontSize(10);
            pdf.setFont("helvetica", "normal");
            pdf.setTextColor(100, 100, 100);
            pdf.text(`Tenant Auditado: ${tenantName}`, 15, 28);
            pdf.text(`Fecha de Generación: ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}`, 15, 34);

            // Calcular dimensiones respetando márgenes
            const pdfWidth = pdf.internal.pageSize.getWidth() - 30; // 15mm por lado
            
            // Cargar imagen temporal para sacar sus medidas
            const img = new Image();
            img.src = imgData;
            await new Promise((resolve) => { img.onload = resolve; });
            
            const pdfHeight = (img.height * pdfWidth) / img.width;

            // Insertar captura del dashboard
            pdf.addImage(imgData, 'PNG', 15, 45, pdfWidth, pdfHeight);
            
            // Descargar
            const filename = `${tenantName.replace(/\\s+/g, '_')}_Executive_Report.pdf`;
            pdf.save(filename);
            
            toast.success("Reporte Ejecutivo descargado", { description: filename });
            addAction({ message: `Reporte Ejecutivo PDF generado exitosamente.`, status: 'success' });
        } catch (error: any) {
            console.error(error);
            toast.error("Fallo de renderizado", { description: error.message || "No se pudo generar el documento PDF." });
            addAction({ message: `Fallo al generar el PDF: ${error.message}`, status: 'error' });
        } finally {
            setLoading(false);
        }
    };

    return (
        <button 
            onClick={handleExport}
            disabled={loading}
            className="flex items-center px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-md shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed ml-auto"
        >
            {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <FileDown className="w-4 h-4 mr-2" />}
            {loading ? 'Renderizando PDF...' : 'Generar Reporte Ejecutivo (PDF)'}
        </button>
    );
}
""")

    # 3. Create src/app/admin/report/page.tsx
    report_dir = os.path.join(base_dir, "src/app/admin/report")
    os.makedirs(report_dir, exist_ok=True)
    with open(os.path.join(report_dir, "page.tsx"), "w") as f:
        f.write(""""use client";
import React, { useEffect, useState } from 'react';
import { useTenant } from '@/components/TenantProvider';
import { useMsal } from '@azure/msal-react';
import CostPieChart from '@/components/CostPieChart';
import PdfExportButton from '@/components/PdfExportButton';
import { FileText, AlertCircle } from 'lucide-react';

export default function ReportGeneratorPage() {
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();
    
    const [dashboardData, setDashboardData] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    
    const totalSavings = dashboardData.reduce((sum, item) => sum + (item.potentialSavings || 0), 0);

    useEffect(() => {
        if (accounts.length === 0 || selectedTenant.id === 'default') return;
        
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
                </div>
            </div>
        </div>
    );
}
""")

    # 4. Update Sidebar
    print("Actualizando Sidebar.tsx...")
    sidebar_path = os.path.join(base_dir, "src/components/Sidebar.tsx")
    with open(sidebar_path, "r") as f:
        sidebar = f.read()

    if "FileText" not in sidebar:
        sidebar = sidebar.replace("    ChevronRight\\n} from 'lucide-react';", "    ChevronRight,\\n    FileText\\n} from 'lucide-react';")
        
    if "Reporte Ejecutivo" not in sidebar:
        sidebar = sidebar.replace(
            "{ href: '/admin/config', label: 'Configuración', icon: Settings }",
            "{ href: '/admin/config', label: 'Configuración', icon: Settings },\\n                { href: '/admin/report', label: 'Reporte Ejecutivo', icon: FileText }"
        )
        with open(sidebar_path, "w") as f:
            f.write(sidebar)

if __name__ == "__main__":
    deploy()
