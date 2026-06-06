"use client";
import React, { useState } from 'react';
import { FileDown, Loader2 } from 'lucide-react';
import { toPng } from 'html-to-image';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { toast } from 'sonner';
import { useActionLogStore } from '@/store/actionLogStore';

interface PdfExportButtonProps {
    targetId: string;
    tenantName: string;
    auditData?: any[];
}

export default function PdfExportButton({ targetId, tenantName, auditData }: PdfExportButtonProps) {
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
            
            if (auditData && auditData.length > 0) {
                pdf.addPage();
                
                pdf.setFontSize(14);
                pdf.setFont("helvetica", "bold");
                pdf.setTextColor(0, 84, 166);
                pdf.text('Desglose de Recursos Afectados e Ineficiencias', 15, 20);

                const tableBody = auditData.map(item => [
                    item.resourceName || item.name || 'N/A',
                    item.issue || item.issueType || 'Ineficiencia Detectada',
                    item.potentialSavings ? `$${item.potentialSavings.toFixed(2)}` : '-'
                ]);

                autoTable(pdf, {
                    startY: 30,
                    head: [['Recurso Afectado', 'Motivo', 'Gasto Generado (USD)']],
                    body: tableBody,
                    theme: 'striped',
                    headStyles: { fillColor: [0, 84, 166] },
                    styles: { fontSize: 9 }
                });
            }
            
            // Abrir en nueva ventana (preview)
            const pdfBlobUrl = pdf.output('bloburl');
            window.open(pdfBlobUrl, '_blank');
            
            // Opcional: Descargar también el archivo
            // pdf.save(filename);
            
            toast.success("Reporte Ejecutivo generado", { description: "El PDF se ha abierto en una nueva pestaña" });
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
