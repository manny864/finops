"use client";
import React, { useState } from 'react';
import { FileDown, Loader2 } from 'lucide-react';
import { toPng } from 'html-to-image';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { toast } from 'sonner';
import { useActionLogStore } from '@/store/actionLogStore';
import { errorMessage } from '@/lib/apiErrors';

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
                pixelRatio: 2, // Mayor calidad
                // Evita fetch de @font-face remotas (p.ej. Google Fonts) que
                // falla en algunos entornos y corta la exportación.
                fontEmbedCSS: ''
            });

            const pdf = new jsPDF({
                orientation: 'portrait',
                unit: 'mm',
                format: 'a4'
            });
            const margin = 20;

            // Añadir el Header corporativo
            pdf.setFontSize(16);
            pdf.setFont("helvetica", "bold");
            pdf.setTextColor(0, 84, 166); // Color Corporativo #0054A6
            pdf.text('CSCloudSolutions - FinOps Executive Report', margin, margin);
            
            pdf.setFontSize(10);
            pdf.setFont("helvetica", "normal");
            pdf.setTextColor(100, 100, 100);
            pdf.text(`Tenant Auditado: ${tenantName}`, margin, margin + 8);
            pdf.text(`Fecha de Generación: ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}`, margin, margin + 14);

            // Calcular dimensiones respetando márgenes
            const pdfWidth = pdf.internal.pageSize.getWidth() - (margin * 2);
            
            // Cargar imagen temporal para sacar sus medidas
            const img = new Image();
            img.src = imgData;
            await new Promise((resolve) => { img.onload = resolve; });
            
            const pdfHeight = (img.height * pdfWidth) / img.width;
            const pageHeight = pdf.internal.pageSize.getHeight();
            const topFirstPage = margin + 20; // header + separación
            const topNextPages = margin;
            const bottomMargin = margin;
            const printableFirstPage = pageHeight - topFirstPage - bottomMargin;
            const printableNextPages = pageHeight - topNextPages - bottomMargin;

            // Insertar captura del dashboard en tantas páginas como sea necesario.
            pdf.addImage(imgData, 'PNG', margin, topFirstPage, pdfWidth, pdfHeight);
            let heightLeft = pdfHeight - printableFirstPage;
            while (heightLeft > 0) {
                pdf.addPage();
                const renderedHeight = pdfHeight - heightLeft;
                const yOffset = topNextPages - renderedHeight;
                pdf.addImage(imgData, 'PNG', margin, yOffset, pdfWidth, pdfHeight);
                heightLeft -= printableNextPages;
            }
            
            if (auditData && auditData.length > 0) {
                pdf.addPage();
                
                pdf.setFontSize(14);
                pdf.setFont("helvetica", "bold");
                pdf.setTextColor(0, 84, 166);
                pdf.text('Desglose de Recursos Afectados e Ineficiencias', margin, margin);

                const tableBody = auditData.map(item => [
                    item.resourceName || item.name || 'N/A',
                    item.issue || item.issueType || 'Ineficiencia Detectada',
                    item.potentialSavings ? `$${item.potentialSavings.toFixed(2)}` : '-'
                ]);

                autoTable(pdf, {
                    startY: margin + 10,
                    head: [['Recurso Afectado', 'Motivo', 'Gasto Generado (USD)']],
                    body: tableBody,
                    theme: 'striped',
                    headStyles: { fillColor: [0, 84, 166] },
                    styles: { fontSize: 9 }
                });
            }

            const safeTenant = String(tenantName || "Cliente")
                .trim()
                .replace(/\s+/g, "_")
                .replace(/[^a-zA-Z0-9_-]/g, "");
            const date = new Date();
            const fileDate = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
            const filename = `Reporte_Ejecutivo_${safeTenant || "Cliente"}_${fileDate}.pdf`;

            pdf.save(filename);

            toast.success("Reporte Ejecutivo generado", { description: "El PDF se descargó con el nombre estándar." });
            addAction({ message: `Reporte Ejecutivo PDF generado exitosamente.`, status: 'success' });
        } catch (error) {
            console.error(error);
            toast.error("Fallo de renderizado", { description: errorMessage(error) || "No se pudo generar el documento PDF." });
            addAction({ message: `Fallo al generar el PDF: ${errorMessage(error)}`, status: 'error' });
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
