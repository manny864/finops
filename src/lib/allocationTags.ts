/**
 * Tags de asignación: el subconjunto de etiquetas por el que se reparte el
 * costo entre equipos, centros de costo y productos.
 *
 * ¿Por qué un subconjunto y no todos los tags? Porque `CostSnapshots` guarda un
 * agregado diario, y la dimensión de tag entra en su clave única. Si se
 * agrupara por el JSON completo de etiquetas, cada recurso aportaría su propia
 * fila —el tag `Name` es distinto en cada uno— y el agregado degeneraría en una
 * copia del detalle, con la cardinalidad y el costo de consulta que eso implica.
 *
 * Agrupando sólo por las etiquetas que las vistas de asignación consultan, la
 * cardinalidad queda acotada al producto de sus valores distintos, que en la
 * práctica es chico: una organización tiene decenas de centros de costo, no
 * decenas de miles.
 *
 * RBAC: módulo puro, sin acceso a datos ni a la nube. No requiere permisos.
 */

import { createHash } from 'crypto';

/**
 * Etiquetas por las que se reparte el costo. Une las obligatorias globales
 * (`tagConfig.ts`) con las que las vistas ya consultan (`Team`) y las
 * convenciones habituales de FinOps.
 *
 * El orden importa: define el orden canónico del hash, así que **agregar una
 * etiqueta al medio cambia el hash de todo lo ya persistido**. Agregar siempre
 * al final.
 */
export const ALLOCATION_TAG_KEYS = [
    'CostCenter',
    'Team',
    'Environment',
    'Department',
    'Role',
    'Project',
    'Owner',
    'Application',
] as const;

export type AllocationTagKey = (typeof ALLOCATION_TAG_KEYS)[number];

/**
 * Índice de búsqueda insensible a mayúsculas y a separadores.
 *
 * En varias nubes las etiquetas son **case-sensitive**, así que `CostCenter`,
 * `costcenter` y `cost-center` conviven como tres etiquetas distintas en la
 * misma cuenta. Es uno de los problemas clásicos de higiene de etiquetado: el
 * costo aparece repartido en tres columnas que en realidad son una. Azure, en
 * cambio, trata los nombres de etiqueta como insensibles a mayúsculas.
 *
 * Se normaliza para que las tres caigan en el mismo cubo de asignación. El
 * valor **no** se normaliza: `prod` y `Prod` pueden ser dos entornos distintos
 * y no nos corresponde decidirlo.
 */
const CANONICAL_BY_NORMALIZED = new Map<string, AllocationTagKey>(
    ALLOCATION_TAG_KEYS.map((k) => [normalizeKey(k), k])
);

/** Baja a minúsculas y quita separadores: `cost-center` y `Cost_Center` → `costcenter`. */
function normalizeKey(key: string): string {
    return key.toLowerCase().replace(/[\s_\-.]/g, '');
}

/**
 * Alias frecuentes que apuntan al mismo concepto de asignación. Sin esto, una
 * cuenta que etiqueta `BusinessUnit` y otra que etiqueta `CostCenter` no se
 * pueden comparar, aunque signifiquen lo mismo para quien paga la factura.
 */
const ALIASES: Record<string, AllocationTagKey> = {
    cc: 'CostCenter',
    costcentre: 'CostCenter',
    costcode: 'CostCenter',
    businessunit: 'CostCenter',
    bu: 'CostCenter',
    squad: 'Team',
    env: 'Environment',
    stage: 'Environment',
    dept: 'Department',
    product: 'Project',
    app: 'Application',
    service: 'Application',
    ownedby: 'Owner',
    contact: 'Owner',
};

/**
 * Quédate sólo con las etiquetas de asignación, con su nombre canónico.
 *
 * Ante dos variantes de la misma etiqueta en un mismo recurso (`CostCenter` y
 * `costcenter`), gana la que coincide exactamente con el nombre canónico; si
 * ninguna coincide, gana la primera en el orden de iteración. Es determinista,
 * que es lo que el hash necesita.
 */
export function pickAllocationTags(tags: unknown): Record<string, string> {
    if (!tags || typeof tags !== 'object' || Array.isArray(tags)) return {};
    const out: Record<string, string> = {};
    const exact = new Set<string>();

    for (const [rawKey, rawValue] of Object.entries(tags as Record<string, unknown>)) {
        if (rawValue === null || rawValue === undefined) continue;
        const value = String(rawValue).trim();
        if (value === '') continue;

        const normalized = normalizeKey(rawKey);
        const canonical = CANONICAL_BY_NORMALIZED.get(normalized) || ALIASES[normalized];
        if (!canonical) continue;

        // Una coincidencia exacta con el nombre canónico no se pisa nunca.
        if (exact.has(canonical)) continue;
        if (rawKey === canonical) exact.add(canonical);
        else if (canonical in out) continue;

        out[canonical] = value;
    }
    return out;
}

/**
 * Serializa las etiquetas de asignación de forma estable, para que dos
 * recursos con las mismas etiquetas produzcan siempre la misma cadena
 * independientemente del orden en que la nube las haya devuelto.
 *
 * Devuelve `''` cuando no hay ninguna, que es el caso del costo sin asignar y
 * el de todo lo que ingesta Azure hoy.
 */
export function serializeAllocationTags(tags: unknown): string {
    const picked = pickAllocationTags(tags);
    const parts: string[] = [];
    for (const key of ALLOCATION_TAG_KEYS) {
        const value = picked[key];
        if (value !== undefined) parts.push(`${key}=${value}`);
    }
    return parts.join('\u0001');
}

/**
 * Clave de agregación de una fila de costo. Es lo que se antepone a la clave
 * `(fecha, región, servicio)` para que dos recursos con distinto centro de
 * costo no colapsen en la misma fila del agregado diario.
 */
export function allocationKey(tags: unknown): string {
    return serializeAllocationTags(tags);
}

/**
 * Las etiquetas de asignación listas para persistir en la columna `Tags`, o
 * `null` si el recurso no tiene ninguna.
 *
 * Se guarda el subconjunto y no el JSON completo a propósito: es exactamente lo
 * que define la fila del agregado. Guardar el resto sería guardar las etiquetas
 * de *uno* de los recursos que se sumaron, dando a entender que valen para
 * todos. El detalle completo vive en `FocusLineItems`.
 */
export function allocationTagsForStorage(tags: unknown): Record<string, string> | null {
    const picked = pickAllocationTags(tags);
    return Object.keys(picked).length > 0 ? picked : null;
}

/**
 * Huella de la clave de asignación, tal como se persiste en
 * `CostSnapshots.allocation_tag_hash`.
 *
 * Se guarda un hash y no la clave literal porque los valores de etiqueta los
 * escribe el cliente y no tienen cota de longitud: un `Project` de 400
 * caracteres haría que la clave única supere el límite de 3072 bytes de InnoDB
 * y el `INSERT` fallaría en producción con datos perfectamente válidos.
 *
 * La cadena vacía se mapea a `''` y no al hash del vacío, para que el costo sin
 * asignar comparta clave con todo lo que ya está persistido (Azure no llena
 * etiquetas en el agregado) y la migración no genere duplicados.
 */
export function hashAllocationKey(serialized: string): string {
    if (serialized === '') return '';
    return createHash('sha256').update(serialized, 'utf8').digest('hex');
}
