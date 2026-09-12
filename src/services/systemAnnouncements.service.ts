import pool from "@/modules/storage/db";
import type { RowDataPacket } from "mysql2";
import {
  BASE_LOCALE,
  type AnnouncementChannel,
  type AnnouncementTranslation,
  type CreateAnnouncementInput,
  type SystemAnnouncement,
  type UpdateAnnouncementInput,
} from "@/types/systemAnnouncements.types";

/**
 * `displayStatus` es derivado, NUNCA persistido (ver comentario de la
 * migración: materializar 'scheduled'/'active'/'finished' como filas
 * exigiría un cron que las mantenga sincronizadas contra `status='cancelled'`
 * ganando nada frente a calcularlo en cada lectura).
 */
function computeDisplayStatus(
  status: SystemAnnouncement["status"],
  startsAt: string,
  endsAt: string,
  now: Date = new Date()
): SystemAnnouncement["displayStatus"] {
  if (status === "draft" || status === "cancelled") return status;
  if (now < new Date(startsAt)) return "scheduled";
  if (now > new Date(endsAt)) return "finished";
  return "active";
}

/**
 * Título y mensaje en el idioma pedido, con fallback al idioma base.
 *
 * Las traducciones son OPCIONALES a propósito (ver la migración): un aviso de
 * caída tiene que poder publicarse con un solo idioma. Se cae al base cuando
 * el locale no está traducido, y también cuando la traducción existe pero
 * quedó con el campo vacío — un título en blanco en pantalla es peor que un
 * título en otro idioma.
 *
 * `pt-BR` cae a `pt` si alguien guardó la traducción con el código corto: el
 * locale de la plataforma es `pt-BR`, pero equivocarse en eso no debería
 * hacer que el usuario brasileño vea español.
 */
export function resolveAnnouncementContent(
  announcement: Pick<SystemAnnouncement, "title" | "message" | "translations">,
  locale: string
): AnnouncementTranslation {
  const base = { title: announcement.title, message: announcement.message };
  if (!locale || locale === BASE_LOCALE || !announcement.translations) return base;

  const candidates = [locale, locale.split("-")[0]];
  for (const key of candidates) {
    const t = announcement.translations[key];
    if (t?.title?.trim() && t?.message?.trim()) return { title: t.title, message: t.message };
  }
  return base;
}

/** Descarta las traducciones incompletas antes de persistir: media traducción
 *  guardada sería un fallback silenciosamente roto más adelante. */
function sanitizeTranslations(
  translations: Record<string, AnnouncementTranslation> | undefined
): string | null {
  if (!translations) return null;
  const clean: Record<string, AnnouncementTranslation> = {};
  for (const [locale, value] of Object.entries(translations)) {
    if (value?.title?.trim() && value?.message?.trim()) {
      clean[locale] = { title: value.title.trim(), message: value.message };
    }
  }
  return Object.keys(clean).length > 0 ? JSON.stringify(clean) : null;
}

function parseJsonColumn<T>(value: unknown): T | null {
  if (!value) return null;
  return (typeof value === "string" ? JSON.parse(value) : value) as T;
}

function rowToAnnouncement(row: RowDataPacket): SystemAnnouncement {
  const startsAt = new Date(row.starts_at).toISOString();
  const endsAt = new Date(row.ends_at).toISOString();
  return {
    id: Number(row.id),
    title: row.title,
    message: row.message,
    translations: parseJsonColumn<Record<string, AnnouncementTranslation>>(row.translations),
    severity: row.severity,
    // mysql2 devuelve una columna SET como string separado por comas.
    channels: String(row.channels || "").split(",").filter(Boolean) as AnnouncementChannel[],
    targetAllTenants: !!row.target_all_tenants,
    targetTenantIds: parseJsonColumn<string[]>(row.target_tenant_ids),
    actionUrl: row.action_url,
    startsAt,
    endsAt,
    status: row.status,
    createdByEmail: row.created_by_email,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    displayStatus: computeDisplayStatus(row.status, startsAt, endsAt),
  };
}

/** Listado completo para el panel SuperAdmin (cualquier status). */
export async function listAnnouncements(): Promise<SystemAnnouncement[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT * FROM SystemAnnouncements ORDER BY created_at DESC"
  );
  return rows.map(rowToAnnouncement);
}

export async function createAnnouncement(
  input: CreateAnnouncementInput,
  createdByEmail: string
): Promise<SystemAnnouncement> {
  if (new Date(input.endsAt) <= new Date(input.startsAt)) {
    throw new Error("La fecha de finalización debe ser posterior a la de inicio.");
  }
  if (input.channels.length === 0) {
    throw new Error("Elegí al menos un canal (banner o popup).");
  }

  const [result]: any = await pool.query(
    `INSERT INTO SystemAnnouncements
       (title, message, translations, severity, channels, target_all_tenants, target_tenant_ids, action_url, starts_at, ends_at, status, created_by_email)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.title.trim(),
      input.message,
      sanitizeTranslations(input.translations),
      input.severity,
      input.channels.join(","),
      input.targetAllTenants,
      input.targetAllTenants ? null : JSON.stringify(input.targetTenantIds || []),
      input.actionUrl?.trim() || null,
      input.startsAt,
      input.endsAt,
      input.status,
      createdByEmail,
    ]
  );

  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT * FROM SystemAnnouncements WHERE id = ?",
    [result.insertId]
  );
  return rowToAnnouncement(rows[0]);
}

export async function updateAnnouncement(
  id: number,
  input: UpdateAnnouncementInput
): Promise<SystemAnnouncement> {
  const sets: string[] = [];
  const params: any[] = [];

  if (input.title !== undefined) { sets.push("title = ?"); params.push(input.title.trim()); }
  if (input.message !== undefined) { sets.push("message = ?"); params.push(input.message); }
  if (input.translations !== undefined) { sets.push("translations = ?"); params.push(sanitizeTranslations(input.translations)); }
  if (input.severity !== undefined) { sets.push("severity = ?"); params.push(input.severity); }
  if (input.channels !== undefined) {
    if (input.channels.length === 0) throw new Error("Elegí al menos un canal (banner, popup o notification).");
    sets.push("channels = ?"); params.push(input.channels.join(","));
  }
  if (input.targetAllTenants !== undefined) { sets.push("target_all_tenants = ?"); params.push(input.targetAllTenants); }
  if (input.targetTenantIds !== undefined) { sets.push("target_tenant_ids = ?"); params.push(JSON.stringify(input.targetTenantIds)); }
  if (input.actionUrl !== undefined) { sets.push("action_url = ?"); params.push(input.actionUrl?.trim() || null); }
  if (input.startsAt !== undefined) { sets.push("starts_at = ?"); params.push(input.startsAt); }
  if (input.endsAt !== undefined) { sets.push("ends_at = ?"); params.push(input.endsAt); }
  if (input.status !== undefined) { sets.push("status = ?"); params.push(input.status); }

  if (sets.length === 0) throw new Error("Nada para actualizar.");

  const [existing] = await pool.query<RowDataPacket[]>("SELECT starts_at, ends_at FROM SystemAnnouncements WHERE id = ?", [id]);
  if (!existing[0]) throw new Error("Anuncio no encontrado.");
  const effectiveStart = input.startsAt ?? existing[0].starts_at;
  const effectiveEnd = input.endsAt ?? existing[0].ends_at;
  if (new Date(effectiveEnd) <= new Date(effectiveStart)) {
    throw new Error("La fecha de finalización debe ser posterior a la de inicio.");
  }

  params.push(id);
  await pool.query(`UPDATE SystemAnnouncements SET ${sets.join(", ")} WHERE id = ?`, params);

  const [rows] = await pool.query<RowDataPacket[]>("SELECT * FROM SystemAnnouncements WHERE id = ?", [id]);
  if (!rows[0]) throw new Error("Anuncio no encontrado.");
  return rowToAnnouncement(rows[0]);
}

export async function deleteAnnouncement(id: number): Promise<void> {
  await pool.query("DELETE FROM SystemAnnouncements WHERE id = ?", [id]);
  await pool.query("DELETE FROM UserAnnouncementDismissals WHERE announcement_id = ?", [id]);
}

/**
 * Anuncios vigentes para un tenant: `published`, dentro de la ventana de
 * fecha, y (todos los tenants O el tenant está en la lista). El filtro por
 * tenant se resuelve en JS sobre las filas ya angostadas por fecha -- no hay
 * JOIN ni índice sobre target_tenant_ids, y no hace falta: el universo de
 * anuncios activos a la vez es chico (manejado a mano por un SuperAdmin).
 *
 * `dismissedAnnouncementIds` se resta acá (no en el caller) para que el
 * caller nunca vea un anuncio de popup que este usuario ya descartó.
 */
export async function getActiveAnnouncementsForTenant(
  tenantId: string,
  userEmail: string,
  /** Idioma activo de la página. El contenido se resuelve acá (server-side) y
   *  no en el cliente: la lógica de fallback vive en un solo lugar y viaja
   *  menos payload. Default al base para que un caller viejo siga andando. */
  locale: string = BASE_LOCALE
): Promise<SystemAnnouncement[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT * FROM SystemAnnouncements
     WHERE status = 'published'
     ORDER BY severity = 'critical' DESC, starts_at DESC`
  );

  // La ventana de vigencia se filtra en JS, NO con `starts_at <= NOW() AND
  // ends_at >= NOW()` en SQL (bug real, encontrado 2026-09-01): `starts_at`/
  // `ends_at` se guardan como el datetime-local NAIVE que tipeó el
  // SuperAdmin (hora de Argentina, sin offset). `NOW()` de MySQL corre en el
  // reloj del CONTENEDOR (UTC en Docker por default) -- comparar un valor
  // naive-Argentina contra un NOW() en UTC da 3hs de diferencia y un anuncio
  // recién creado aparece "ya vencido".
  //
  // `new Date(row.starts_at)` no tiene ese problema: mysql2 devuelve un objeto
  // Date interpretando el datetime naive en la timezone DEL PROCESO NODE, que
  // es la misma que la del navegador que lo escribió (deploy single-region).
  // Es el MISMO criterio que ya usa `computeDisplayStatus` -- estaban
  // comparando con dos relojes distintos para la misma pregunta.
  const now = new Date();
  const published = rows.filter((row) => new Date(row.starts_at) <= now && new Date(row.ends_at) >= now);

  const forTenant = published.filter((row) => {
    if (row.target_all_tenants) return true;
    const ids = parseJsonColumn<string[]>(row.target_tenant_ids) || [];
    return ids.includes(tenantId);
  });

  if (forTenant.length === 0) return [];

  const [dismissedRows] = await pool.query<RowDataPacket[]>(
    "SELECT announcement_id FROM UserAnnouncementDismissals WHERE user_email = ? AND announcement_id IN (?)",
    [userEmail, forTenant.map((r) => r.id)]
  );
  const dismissed = new Set(dismissedRows.map((r) => Number(r.announcement_id)));

  // El banner no se descarta a nivel servidor (colapso local por sesión, ver
  // GlobalAnnouncementBanner); sólo el popup necesita que este filtro le
  // esconda lo ya visto. Se devuelven todos y el componente de cada canal
  // decide qué mostrar -- `dismissedByUser` viaja en cada item para que el
  // cliente no tenga que pedir dos endpoints distintos.
  return forTenant.map((row) => {
    const announcement = rowToAnnouncement(row);
    const resolved = resolveAnnouncementContent(announcement, locale);
    return {
      ...announcement,
      dismissedByUser: dismissed.has(Number(row.id)),
      resolvedTitle: resolved.title,
      resolvedMessage: resolved.message,
    };
  });
}

export async function recordDismissal(announcementId: number, userEmail: string): Promise<void> {
  await pool.query(
    "INSERT IGNORE INTO UserAnnouncementDismissals (announcement_id, user_email) VALUES (?, ?)",
    [announcementId, userEmail]
  );
}
