/**
 * Exportación visual de gráficos y dashboards a SVG/PNG/PDF.
 * Utiliza `html-to-image` para capturar con fidelidad total el contenedor
 * (incluyendo SVG de Recharts, ejes, tipografías y leyendas HTML) y `jspdf`
 * para la generación del documento ejecutivo.
 */
import jsPDF from "jspdf";
import { toPng, toSvg } from "html-to-image";

// Polyfill de seguridad para entornos sin SVGImageElement en global scope (JSDOM / SSR / webviews)
if (typeof window !== "undefined" && typeof (window as any).SVGImageElement === "undefined") {
    (window as any).SVGImageElement = class SVGImageElement extends (window.SVGElement || Object) {};
}

function triggerDownload(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function dataUrlToBlob(dataUrl: string): Blob {
    const parts = dataUrl.split(",");
    const mime = parts[0].match(/:(.*?);/)?.[1] || "image/png";
    const bstr = atob(parts[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
        u8arr[n] = bstr.charCodeAt(n);
    }
    return new Blob([u8arr], { type: mime });
}

/**
 * Exporta un elemento DOM (o contenedor de gráfico) como imagen PNG de alta resolución.
 */
export async function exportElementAsPng(
    element: HTMLElement | SVGSVGElement,
    filename: string,
    scale = 2
): Promise<void> {
    const target = (element instanceof SVGSVGElement ? (element.parentElement || element) : element) as HTMLElement;
    try {
        const dataUrl = await toPng(target, {
            backgroundColor: "#ffffff",
            pixelRatio: scale,
            fontEmbedCSS: "",
            cacheBust: true,
        });
        const blob = dataUrlToBlob(dataUrl);
        triggerDownload(blob, filename);
    } catch {
        // Fallback vía canvas directo si toPng falla
        const svgEl = target instanceof SVGSVGElement ? target : target.querySelector("svg");
        if (!svgEl) throw new Error("No se pudo exportar el elemento a PNG.");
        const rect = svgEl.getBoundingClientRect();
        const width = Math.max(1, Math.round((rect.width || 600) * scale));
        const height = Math.max(1, Math.round((rect.height || 300) * scale));
        const clone = svgEl.cloneNode(true) as SVGSVGElement;
        if (!clone.getAttribute("xmlns")) clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
        clone.setAttribute("width", String(width));
        clone.setAttribute("height", String(height));
        const bgRect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        bgRect.setAttribute("width", "100%");
        bgRect.setAttribute("height", "100%");
        bgRect.setAttribute("fill", "#ffffff");
        clone.insertBefore(bgRect, clone.firstChild);
        const svgString = new XMLSerializer().serializeToString(clone);
        const blob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
        const blobUrl = URL.createObjectURL(blob);
        const img = new Image();
        await new Promise<void>((resolve, reject) => {
            img.onload = () => {
                const canvas = document.createElement("canvas");
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext("2d");
                if (!ctx) { URL.revokeObjectURL(blobUrl); reject(new Error("No se pudo obtener contexto 2D")); return; }
                ctx.drawImage(img, 0, 0, width, height);
                URL.revokeObjectURL(blobUrl);
                canvas.toBlob((b) => {
                    if (b) triggerDownload(b, filename);
                    resolve();
                }, "image/png");
            };
            img.onerror = () => {
                URL.revokeObjectURL(blobUrl);
                // Último recurso: descargar el SVG si la rasterización de canvas falla
                triggerDownload(blob, filename.replace(/\.png$/i, ".svg"));
                resolve();
            };
            img.src = blobUrl;
        });
    }
}

/**
 * Exporta un elemento DOM (o contenedor de gráfico) como archivo SVG vectorial.
 */
export async function exportElementAsSvg(
    element: HTMLElement | SVGSVGElement,
    filename: string
): Promise<void> {
    const target = (element instanceof SVGSVGElement ? (element.parentElement || element) : element) as HTMLElement;
    try {
        const dataUrl = await toSvg(target, {
            backgroundColor: "#ffffff",
            fontEmbedCSS: "",
            cacheBust: true,
        });
        // Si el dataUrl es un svg codificado en URI o base64
        if (dataUrl.startsWith("data:image/svg+xml;charset=utf-8,")) {
            const svgText = decodeURIComponent(dataUrl.replace("data:image/svg+xml;charset=utf-8,", ""));
            triggerDownload(new Blob([svgText], { type: "image/svg+xml;charset=utf-8" }), filename);
        } else if (dataUrl.includes(";base64,")) {
            const blob = dataUrlToBlob(dataUrl);
            triggerDownload(blob, filename);
        } else {
            const res = await fetch(dataUrl);
            triggerDownload(await res.blob(), filename);
        }
    } catch {
        // Fallback: serialización directa con estilos inline si html-to-image falla
        const svgEl = target instanceof SVGSVGElement ? target : target.querySelector("svg");
        if (!svgEl) throw new Error("No se encontró elemento SVG para exportar.");
        const clone = svgEl.cloneNode(true) as SVGSVGElement;
        if (!clone.getAttribute("xmlns")) clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
        const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        rect.setAttribute("width", "100%");
        rect.setAttribute("height", "100%");
        rect.setAttribute("fill", "#ffffff");
        clone.insertBefore(rect, clone.firstChild);
        const svgString = new XMLSerializer().serializeToString(clone);
        triggerDownload(new Blob([svgString], { type: "image/svg+xml;charset=utf-8" }), filename);
    }
}

/**
 * Genera un PDF ejecutivo con membrete corporativo CSCloudSolutions y el gráfico embebido.
 */
export async function exportElementAsPdf(
    element: HTMLElement | SVGSVGElement,
    filename: string,
    title: string,
    subtitle?: string
): Promise<void> {
    const target = (element instanceof SVGSVGElement ? (element.parentElement || element) : element) as HTMLElement;
    const dataUrl = await toPng(target, {
        backgroundColor: "#ffffff",
        pixelRatio: 2,
        fontEmbedCSS: "",
        cacheBust: true,
    });

    const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    const pageWidth = pdf.internal.pageSize.getWidth();

    // Membrete oficial CSCloudSolutions (#0054A6)
    pdf.setFontSize(16);
    pdf.setFont("helvetica", "bold");
    pdf.setTextColor(0, 84, 166);
    pdf.text("CSCloudSolutions", 15, 18);

    pdf.setFontSize(12);
    pdf.setTextColor(27, 42, 65); // #1B2A41
    pdf.text(title, 15, 26);

    let y = 32;
    if (subtitle) {
        pdf.setFontSize(9);
        pdf.setFont("helvetica", "normal");
        pdf.setTextColor(100, 116, 139);
        pdf.text(subtitle, 15, y);
        y += 6;
    }

    // Cargar dimensiones de la imagen con timeout de seguridad
    const img = new Image();
    img.src = dataUrl;
    await new Promise<void>((resolve) => {
        if (img.complete && img.naturalWidth !== 0) {
            resolve();
        } else {
            const timer = setTimeout(() => resolve(), 300);
            img.onload = () => { clearTimeout(timer); resolve(); };
            img.onerror = () => { clearTimeout(timer); resolve(); };
        }
    });

    const imgNaturalWidth = img.naturalWidth || img.width || 600;
    const imgNaturalHeight = img.naturalHeight || img.height || 300;
    const imgWidth = pageWidth - 30;
    const imgHeight = Math.min(145, (imgNaturalHeight * imgWidth) / imgNaturalWidth);

    pdf.addImage(dataUrl, "PNG", 15, y + 2, imgWidth, imgHeight);
    pdf.save(filename);
}

// Aliases de compatibilidad hacia atrás
export const exportSvgElementAsSvg = exportElementAsSvg;
export const exportSvgElementAsPng = exportElementAsPng;
export const exportSvgElementAsPdf = exportElementAsPdf;
