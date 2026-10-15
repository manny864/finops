// AISEC-03: valores del tenant (nombre, alcance) y texto del LLM que se interpolan en las plantillas.
export const escapeHtml = (v: unknown): string =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/** Contenido de una cadena CSS entre comillas dobles (`content: "..."`). */
export const escapeCssString = (v: unknown): string =>
  String(v ?? "").replace(/[^\p{L}\p{N} .,:·_()-]/gu, (c) => `\\${c.codePointAt(0)!.toString(16)} `);
