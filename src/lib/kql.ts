/**
 * Utilidades para armar consultas KQL contra Azure Resource Graph.
 *
 * ARG no tiene parámetros vinculados como SQL: la consulta es una cadena, así
 * que cualquier valor que se interpole hay que escaparlo a mano.
 */

/**
 * Escapa un valor para meterlo dentro de un literal de cadena KQL (`'...'`).
 *
 * EL ORDEN IMPORTA. Se escapa `\` --el propio carácter de escape de KQL--
 * ANTES que `'`. Al revés, un valor terminado en `\` consumiría la comilla de
 * escape recién insertada y cerraría el literal antes de tiempo, que es
 * inyección KQL.
 *
 * POR QUE VIVE ACA
 * Esta función existía desde una auditoría previa, pero definida DENTRO de
 * `api/cost-groups/[name]/route.ts`, así que nadie más podía importarla. El
 * resultado (auditoría 2026-09-04, SEC-02): `azureResourceCounts.ts` armaba su
 * propia versión que BORRABA las comillas en vez de escaparlas y no tocaba las
 * barras invertidas — el mismo bug que el comentario original documentaba haber
 * arreglado, sobreviviendo a tres metros de distancia.
 *
 * Un arreglo atrapado en un archivo de ruta no es un arreglo del repositorio.
 */
export function escapeKql(s: string): string {
    return String(s ?? "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}
