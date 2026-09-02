export type AnnouncementSeverity = "info" | "maintenance" | "warning" | "critical";
export type AnnouncementChannel = "banner" | "popup";
export type AnnouncementStatus = "draft" | "published" | "cancelled";

/** Idioma base del contenido: `title`/`message` se guardan en el defaultLocale
 *  de `src/i18n/routing.ts`. Las traducciones son opcionales y caen a este. */
export const BASE_LOCALE = "es";
/** Los idiomas traducibles, sin el base (que vive en `title`/`message`). */
export const TRANSLATABLE_LOCALES = ["en", "pt-BR"] as const;

export interface AnnouncementTranslation {
  title: string;
  message: string;
}

export interface SystemAnnouncement {
  id: number;
  /** Contenido en el idioma base (`BASE_LOCALE`). */
  title: string;
  message: string;
  /** Traducciones opcionales por locale. Ausente = usar el idioma base. */
  translations: Record<string, AnnouncementTranslation> | null;
  /** Sólo poblado por `getActiveAnnouncementsForTenant`: el `title`/`message`
   *  ya resueltos al idioma pedido (con fallback al base). El panel SuperAdmin
   *  usa `title`/`message` crudos, porque edita el original. */
  resolvedTitle?: string;
  resolvedMessage?: string;
  severity: AnnouncementSeverity;
  channels: AnnouncementChannel[];
  targetAllTenants: boolean;
  targetTenantIds: string[] | null;
  actionUrl: string | null;
  startsAt: string;
  endsAt: string;
  status: AnnouncementStatus;
  createdByEmail: string;
  createdAt: string;
  updatedAt: string;
  /** Calculado al leer, no persistido (ver comentario de la migración). */
  displayStatus: "draft" | "scheduled" | "active" | "finished" | "cancelled";
  /** Sólo poblado por `getActiveAnnouncementsForTenant` (requiere saber quién
   *  pregunta); `undefined` en el listado del panel SuperAdmin. */
  dismissedByUser?: boolean;
}

export interface CreateAnnouncementInput {
  title: string;
  message: string;
  /** Opcional: una entrada por locale traducido. Las vacías se descartan. */
  translations?: Record<string, AnnouncementTranslation>;
  severity: AnnouncementSeverity;
  channels: AnnouncementChannel[];
  targetAllTenants: boolean;
  targetTenantIds?: string[];
  actionUrl?: string | null;
  startsAt: string;
  endsAt: string;
  status: "draft" | "published";
}

export type UpdateAnnouncementInput = Partial<CreateAnnouncementInput> & {
  status?: AnnouncementStatus;
};
