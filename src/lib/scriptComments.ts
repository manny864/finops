/**
 * Resuelve los comentarios de los scripts CLI/Bicep que devuelven las rutas de
 * bases de datos.
 *
 * El servidor emite marcadores en vez de la frase:
 *
 *     # {{cmt.deleteIdleInstance}}
 *     az redis delete --name ...
 *
 * y el cliente los reemplaza por la traduccion antes de pintar el bloque.
 *
 * **Por que asi y no pasandole el locale a la ruta.** Las seis rutas de bases de
 * datos cachean con `getDiagnosticsCacheKey(tenantId, ...)`, que NO incluye el
 * locale. Un script con los comentarios ya traducidos, guardado en ese cache, se
 * sirve despues al lector de otro idioma. El marcador es locale-independiente,
 * asi que la entrada de cache vale para los tres idiomas y no hay que triplicarla.
 *
 * Si falta la clave, next-intl devuelve la ruta de la clave y quedaria visible
 * dentro del script. Por eso el marcador sin resolver se deja COMO ESTA en vez de
 * pintar `ScriptComments.loQueSea`: un comentario raro molesta menos que un
 * comentario que parece una clave de i18n, y salta igual en la revision.
 */
const MARCADOR = /\{\{cmt\.([A-Za-z0-9_]+)\}\}/g;

export function resolveScriptComments(
  code: string | undefined,
  t: (key: string) => string,
): string {
  if (!code) return "";
  return code.replace(MARCADOR, (crudo, clave) => {
    const traducido = t(clave);
    // next-intl devuelve la ruta de la clave cuando no existe: eso incluye un
    // punto, que un comentario traducido no va a tener al principio.
    return traducido && !traducido.startsWith("ScriptComments.") ? traducido : crudo;
  });
}
