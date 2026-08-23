/**
 * Utilidad de exportación de archivos Power Query M (.pq) para Power BI Desktop / Excel.
 */
export function downloadPqFile(filename: string, content: string): void {
    if (typeof window === "undefined") return;
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename.endsWith(".pq") ? filename : `${filename}.pq`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}
