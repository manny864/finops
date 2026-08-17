/**
 * Exportación visual de gráficos SVG (Recharts) a SVG/PNG/PDF sin
 * dependencias nuevas — el propio SVG del gráfico ya vive en el DOM
 * (Recharts renderiza a `<svg>`), así que solo hace falta serializarlo.
 * PNG se obtiene dibujando ese SVG en un `<canvas>` vía `Image()`; PDF
 * reutiliza jsPDF (ya es dependencia del repo, ver ScenarioManager) embebiendo
 * el PNG resultante.
 */
import jsPDF from "jspdf";

function serializeSvg(svgEl: SVGSVGElement): string {
    const clone = svgEl.cloneNode(true) as SVGSVGElement;
    if (!clone.getAttribute("xmlns")) clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    // Fondo blanco explícito: sin esto el PNG exportado queda transparente y
    // se ve negro/roto al pegarlo en PowerPoint/Slides.
    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    rect.setAttribute("width", "100%");
    rect.setAttribute("height", "100%");
    rect.setAttribute("fill", "#ffffff");
    clone.insertBefore(rect, clone.firstChild);
    return new XMLSerializer().serializeToString(clone);
}

function triggerDownload(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

/** Descarga el SVG del gráfico tal cual, como archivo .svg. */
export function exportSvgElementAsSvg(svgEl: SVGSVGElement, filename: string) {
    const svgString = serializeSvg(svgEl);
    triggerDownload(new Blob([svgString], { type: "image/svg+xml;charset=utf-8" }), filename);
}

/** Rasteriza el SVG del gráfico a PNG de alta resolución (2x por defecto) y lo descarga. */
export async function exportSvgElementAsPng(svgEl: SVGSVGElement, filename: string, scale = 2): Promise<void> {
    const dataUrl = await svgToPngDataUrl(svgEl, scale);
    const res = await fetch(dataUrl);
    triggerDownload(await res.blob(), filename);
}

/** Genera un PDF ejecutivo de una sola página con el gráfico embebido. */
export async function exportSvgElementAsPdf(
    svgEl: SVGSVGElement,
    filename: string,
    title: string,
    subtitle?: string
): Promise<void> {
    const dataUrl = await svgToPngDataUrl(svgEl, 2);
    const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    pdf.setFontSize(16);
    pdf.setFont("helvetica", "bold");
    pdf.setTextColor(0, 84, 166);
    pdf.text("CSCloudSolutions", 15, 18);
    pdf.setFontSize(12);
    pdf.setTextColor(30, 30, 30);
    pdf.text(title, 15, 26);
    let y = 32;
    if (subtitle) {
        pdf.setFontSize(9);
        pdf.setFont("helvetica", "normal");
        pdf.setTextColor(100, 100, 100);
        pdf.text(subtitle, 15, y);
        y += 6;
    }
    const pageWidth = pdf.internal.pageSize.getWidth();
    const imgWidth = pageWidth - 30;
    const svgRect = svgEl.getBoundingClientRect();
    const imgHeight = (svgRect.height / Math.max(svgRect.width, 1)) * imgWidth;
    pdf.addImage(dataUrl, "PNG", 15, y + 4, imgWidth, imgHeight);
    pdf.save(filename);
}

function svgToPngDataUrl(svgEl: SVGSVGElement, scale: number): Promise<string> {
    return new Promise((resolve, reject) => {
        const rect = svgEl.getBoundingClientRect();
        const width = Math.max(1, Math.round(rect.width * scale));
        const height = Math.max(1, Math.round(rect.height * scale));
        const svgString = serializeSvg(svgEl);
        const svgBlob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
        const url = URL.createObjectURL(svgBlob);
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement("canvas");
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext("2d");
            if (!ctx) { URL.revokeObjectURL(url); reject(new Error("No se pudo obtener contexto de canvas")); return; }
            ctx.drawImage(img, 0, 0, width, height);
            URL.revokeObjectURL(url);
            resolve(canvas.toDataURL("image/png"));
        };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("No se pudo rasterizar el gráfico")); };
        img.src = url;
    });
}
