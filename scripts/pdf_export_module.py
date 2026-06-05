import os

base_dir = "/Users/manuelchavez/Documents/FinOpsProyect"

def deploy():
    print("Creando PdfExportButton.tsx...")
    comp_path = os.path.join(base_dir, "src/components/PdfExportButton.tsx")
    with open(comp_path, "w") as f:
        f.write(""""use client";
import React, { useState } from 'react';
import { FileDown, Loader2 } from 'lucide-react';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import { toast } from 'sonner';

interface PdfExportButtonProps {
    targetId: string;
    tenantName: string;
}

export default function PdfExportButton({ targetId, tenantName }: PdfExportButtonProps) {
    const [loading, setLoading] = useState(false);

    const handleExport = async () => {
        setLoading(true);
        try {
            const element = document.getElementById(targetId);
            if (!element) throw new Error("Área de exportación no encontrada en el DOM.");

            // Aumentar la escala para asegurar textos legibles
            const canvas = await html2canvas(element, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
            const imgData = canvas.toDataURL('image/png');

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
            const pdfHeight = (canvas.height * pdfWidth) / canvas.width;

            // Insertar captura del dashboard
            pdf.addImage(imgData, 'PNG', 15, 45, pdfWidth, pdfHeight);
            
            // Descargar
            const filename = `${tenantName.replace(/\\s+/g, '_')}_Executive_Report.pdf`;
            pdf.save(filename);
            
            toast.success("Reporte Ejecutivo descargado exitosamente", { description: filename });
        } catch (error) {
            console.error(error);
            toast.error("Fallo de renderizado", { description: "No se pudo generar el documento PDF." });
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
            {loading ? 'Renderizando PDF...' : 'Descargar Reporte Ejecutivo (PDF)'}
        </button>
    );
}
""")

    print("Actualizando src/app/page.tsx...")
    page_path = os.path.join(base_dir, "src/app/page.tsx")
    with open(page_path, "r") as f:
        page_content = f.read()

    if "PdfExportButton" not in page_content:
        # Añadir Import
        page_content = page_content.replace(
            "import AdvisorPanel from \"@/components/AdvisorPanel\";",
            "import AdvisorPanel from \"@/components/AdvisorPanel\";\nimport PdfExportButton from \"@/components/PdfExportButton\";"
        )
        
        # Envolver el contenido del dashboard
        target_div = """    <div className="flex flex-col gap-8 animate-in fade-in duration-500">
      <div className="flex justify-end w-full">
          <PdfExportButton targetId="pdf-export-area" tenantName={selectedTenant.name || 'Global'} />
      </div>
      
      <div id="pdf-export-area" className="flex flex-col gap-8 bg-transparent p-2">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-end border-b border-gray-200 dark:border-gray-800 pb-4 gap-4">"""
        
        page_content = page_content.replace(
            """    <div className="flex flex-col gap-8 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end border-b border-gray-200 pb-4 gap-4">""",
            target_div
        )

        # Cerrar el div del área
        page_content = page_content.replace(
            """      </div>

      {selectedCategory && (""",
            """      </div>
      </div>

      {selectedCategory && ("""
        )
        
        with open(page_path, "w") as f:
            f.write(page_content)

    print("Generando SOP...")
    sop_path = os.path.join(base_dir, "directivas/pdf_export_SOP.md")
    os.makedirs(os.path.dirname(sop_path), exist_ok=True)
    with open(sop_path, "w") as f:
        f.write("# PDF Export SOP\\n\\n")
        f.write("- **Dependencias Clientside**: Usamos `html2canvas` para realizar una captura fotográfica del DOM y luego la empaquetamos con `jspdf`. Esto asegura que las gráficas y la UI se vean idénticas al navegador y no se quiebren por CSS incompatibles de print.\\n")
        f.write("- **Renderizado**: Asegúrate de que el contenedor envuelto por el ID `pdf-export-area` tenga colores definidos, de lo contrario `html2canvas` pintará todo en negro o transparente si hay un `bg-transparent`. En el script pasamos `backgroundColor: '#ffffff'` para forzar fondos limpios.\\n")
        f.write("- **Estado Asíncrono**: La generación de PDF con canvas bloquea momentáneamente el DOM principal, por lo que deshabilitamos el botón y mostramos el icono de Loading (`Loader2`) preventivamente.\\n")

if __name__ == "__main__":
    deploy()
    print("PDF Export Module Deploy completed.")
