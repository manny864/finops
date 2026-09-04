/**
 * Las etiquetas FinOps obligatorias. UNA definición, para todos.
 *
 * Habia tres, y no coincidian:
 *
 *   1. Esta lista           -> Environment, Role, CostCenter, Department
 *      (la usaba solo /api/tags/compliance, o sea la auditoria de
 *      governance/tags)
 *   2. El KQL del detector  -> CostCenter, Owner, Environment
 *      (`kqlCatalog.taggingNonCompliance`, lo que alimenta financial-leaks)
 *   3. El modal de remediar -> CostCenter, Environment, Owner
 *
 * El efecto: un recurso con las cuatro etiquetas de la politica pero sin
 * `Owner` --que no es obligatoria en ninguna politica-- salia "100% Compliant"
 * en governance/tags y "Sin Etiquetas FinOps" en financial-leaks al mismo
 * tiempo. Y remediarlo desde el modal no lo arreglaba, porque escribia
 * justamente las tres que no son.
 *
 * Los valores sugeridos estaban hardcodeados en el JSX de la tarjeta de
 * politicas de `TagGovernancePanel`, sin llegar a ningun lado. Ahora salen de
 * aca, asi que lo que la pantalla dice que hay que poner es lo que el modal
 * ofrece.
 */
export const GLOBAL_MANDATORY_TAGS = ['Environment', 'Role', 'CostCenter', 'Department'];

/**
 * Vocabulario sugerido por etiqueta. Es una SUGERENCIA, no una restricción: los
 * campos del modal aceptan texto libre porque cada cliente nombra sus centros
 * de costo como quiere, y bloquearlos convertiria la remediacion en un embudo.
 */
export const TAG_SUGGESTED_VALUES: Record<string, string[]> = {
    Environment: ['prod', 'stg', 'dev', 'qa', 'sandbox'],
    Role: ['database', 'api', 'frontend', 'worker'],
    CostCenter: ['FinOps', 'Engineering', 'CorePlatform'],
    Department: ['CloudOps', 'DataTeam', 'SecurityOps'],
};

/**
 * Predicado KQL que matchea un recurso al que le falta alguna obligatoria.
 *
 * `tags` se baja a minusculas ENTERO antes de mirarlo: el acceso dinamico de
 * Resource Graph distingue mayusculas, pero las etiquetas de Azure no, asi que
 * un recurso etiquetado `environment=prod` daba `isnull(tags.Environment)` y
 * salia como incumplidor. La auditoria de governance/tags ya comparaba sin
 * distinguir mayusculas --de ahi otra parte del desacuerdo entre las dos
 * pantallas--. Bajar tambien los valores no molesta: solo se prueba si estan
 * vacios.
 *
 * `isempty` y no `isnull` porque una etiqueta presente con valor vacio no
 * cumple nada, y es como la cuenta `/api/tags/compliance`.
 */
export function kqlFaltanEtiquetasObligatorias(): string {
    const condiciones = GLOBAL_MANDATORY_TAGS
        .map((tag) => `isempty(tostring(etiquetas['${tag.toLowerCase()}']))`)
        .join(' or ');
    return `extend etiquetas = todynamic(tolower(tostring(tags))) | where ${condiciones}`;
}
