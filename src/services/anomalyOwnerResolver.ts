import pool from "@/modules/storage/db";
import type { RowDataPacket } from "mysql2";

/**
 * MEJ-33 paso 2: a quién le corresponde un desvío de gasto.
 *
 * EL PRINCIPIO
 * La plataforma NO inventa dueños. Deriva la responsabilidad del modelo de
 * gobernanza que el cliente ya definió —sus Cost Groups con dueño, o la
 * etiqueta `Owner` que audita /governance/tags— y cuando ese modelo no alcanza,
 * devuelve `null` para que el desvío se muestre explícitamente como "sin
 * asignar".
 *
 * Asignarle un desvío a alguien que no corresponde es peor que no asignarlo:
 * esa persona aprende a ignorar las alertas, y ahí se pierde el canal entero.
 * En cambio "sin asignar" es información accionable — es el argumento para que
 * el cliente complete su modelo de etiquetas.
 *
 * SÓLO SE MIRA EL CONTRIBUYENTE PRINCIPAL
 * `top_contributors` viene ordenado por delta. Si el resource group que causó
 * el pico no tiene dueño resoluble, el desvío queda sin asignar aunque el
 * segundo o el tercero sí lo tengan: atribuirle el pico al dueño de un
 * contribuyente menor es decirle "tu recurso causó esto" cuando mayormente no
 * fue así.
 */

export type AssignmentVia =
  | "cost_group_membership"
  | "cost_group_pattern"
  | "cost_group_tag"
  | "owner_tag";

export interface OwnerResolution {
  assignedTo: string;
  /** Por qué vía se resolvió. Se persiste para que la asignación sea auditable:
   *  una asignación que el usuario no puede explicar es una que va a ignorar. */
  assignedVia: AssignmentVia;
  /** El grupo o la etiqueta concreta que lo resolvió. */
  detail: string;
}

/** Sólo se necesita el resource group; el resto del contribuyente no aporta. */
export interface ContributorLike {
  resource_group?: string;
}

/**
 * Resuelve el dueño en orden de MÁS a MENOS explícito. El primero que responde
 * gana: una asignación manual de un resource group a un Cost Group es una
 * decisión humana deliberada y debe pesar más que una coincidencia de patrón.
 */
export async function resolveAnomalyOwner(
  tenantId: string,
  topContributors: ContributorLike[] | null | undefined
): Promise<OwnerResolution | null> {
  const rg = topContributors?.[0]?.resource_group;
  if (!rg || rg === "*") return null;

  // 1. Pertenencia explícita: alguien asignó este RG a un grupo a mano.
  const membership = await queryOne(
    `SELECT u.email, cg.name
       FROM CostGroupResourceGroups cgrg
       JOIN CostGroups cg ON cg.tenant_id = cgrg.tenant_id AND cg.name = cgrg.group_name
       JOIN Users u ON u.id = cg.owner_user_id
      WHERE cgrg.tenant_id = ? AND LOWER(cgrg.resource_group) = LOWER(?)
        AND cg.owner_user_id IS NOT NULL AND u.email IS NOT NULL
      LIMIT 1`,
    [tenantId, rg]
  );
  if (membership) {
    return { assignedTo: membership.email, assignedVia: "cost_group_membership", detail: membership.name };
  }

  // 2. Regla por patrón de nombre de resource group.
  const pattern = await queryOne(
    `SELECT u.email, cg.name
       FROM CostGroups cg
       JOIN Users u ON u.id = cg.owner_user_id
      WHERE cg.tenant_id = ? AND cg.match_type = 'name_pattern'
        AND cg.match_rg_pattern IS NOT NULL AND cg.match_rg_pattern <> ''
        AND LOWER(?) LIKE LOWER(cg.match_rg_pattern)
        AND cg.owner_user_id IS NOT NULL AND u.email IS NOT NULL
      LIMIT 1`,
    [tenantId, rg]
  );
  if (pattern) {
    return { assignedTo: pattern.email, assignedVia: "cost_group_pattern", detail: pattern.name };
  }

  // 3. Regla por etiqueta: el RG lleva la etiqueta que define al grupo. Se lee
  //    de `CostSnapshots.Tags`, que MEJ-30 empezó a poblar desde el export.
  const byTag = await queryOne(
    `SELECT u.email, cg.name
       FROM CostGroups cg
       JOIN Users u ON u.id = cg.owner_user_id
      WHERE cg.tenant_id = ? AND cg.match_type = 'tag'
        AND cg.owner_user_id IS NOT NULL AND u.email IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM CostSnapshots cs
           WHERE cs.tenant_id = cg.tenant_id
             AND LOWER(cs.resource_group) = LOWER(?)
             AND cs.Tags IS NOT NULL
             AND JSON_UNQUOTE(JSON_EXTRACT(cs.Tags, CONCAT('$.', cg.match_tag_key))) = cg.match_tag_value
           LIMIT 1
        )
      LIMIT 1`,
    [tenantId, rg]
  );
  if (byTag) {
    return { assignedTo: byTag.email, assignedVia: "cost_group_tag", detail: byTag.name };
  }

  // 4. Último recurso: la etiqueta `Owner` del propio recurso. No exige que la
  //    persona sea usuario de la plataforma — si el cliente etiquetó un correo,
  //    ése es su modelo de responsabilidad y hay que respetarlo.
  const ownerTag = await queryOne(
    `SELECT JSON_UNQUOTE(JSON_EXTRACT(Tags, '$.Owner')) AS email
       FROM CostSnapshots
      WHERE tenant_id = ? AND LOWER(resource_group) = LOWER(?)
        AND Tags IS NOT NULL
        AND JSON_UNQUOTE(JSON_EXTRACT(Tags, '$.Owner')) IS NOT NULL
      ORDER BY date DESC
      LIMIT 1`,
    [tenantId, rg]
  );
  if (ownerTag?.email && String(ownerTag.email).includes("@")) {
    return { assignedTo: String(ownerTag.email), assignedVia: "owner_tag", detail: `etiqueta Owner en ${rg}` };
  }

  return null;
}

async function queryOne(sql: string, params: unknown[]): Promise<any | null> {
  try {
    const [rows] = await pool.query<RowDataPacket[]>(sql, params);
    return rows[0] || null;
  } catch (e) {
    // Una tabla ausente o un JSON inválido no debe romper la detección: el
    // desvío se persiste igual, sólo que sin asignar.
    console.warn("[anomalyOwnerResolver] consulta falló, se sigue sin asignar:", (e as Error)?.message);
    return null;
  }
}
