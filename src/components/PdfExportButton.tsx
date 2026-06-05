"use client";
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
            const filename = `${tenantName.replace(/\s+/g, '_')}_Executive_Report.pdf`;
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
