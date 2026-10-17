/**
 * STRIDE-03 — por qué una persona del directorio de un tenant NO puede entrar a él, en un formato que la interfaz puede
 * mostrar. Tipos puros: los importan el servidor (guard, `/api/me/acceso`, `/api/tenants`) y la pantalla del cliente.
 *
 *  - SIN_CUPO:        el plan del tenant ya tiene todos sus usuarios en uso (lleva `tier` y `limite`).
 *  - SIN_SUSCRIPCION: el tenant no existe o no tiene una suscripción que admita acceso.
 *  - DESHABILITADA:   un administrador deshabilitó la cuenta.
 *  - NO_INVITADO:     la cuenta fue invitada y un administrador todavía no la activó.
 *  - SIN_ACCESO:      cualquier otra negativa de membresía (otro directorio, tenant sin usuarios, sin id inmutable).
 */
export type MotivoDeAcceso = "SIN_CUPO" | "SIN_SUSCRIPCION" | "DESHABILITADA" | "NO_INVITADO" | "SIN_ACCESO";

export interface AccesoDenegado {
  motivo: MotivoDeAcceso;
  tier?: string;
  limite?: number;
}

/** Respuesta de `GET /api/me/acceso`. */
export type AccesoDelTenant = { ok: true } | ({ ok: false } & AccesoDenegado);

export const MOTIVOS_DE_ACCESO: readonly MotivoDeAcceso[] = [
  "SIN_CUPO",
  "SIN_SUSCRIPCION",
  "DESHABILITADA",
  "NO_INVITADO",
  "SIN_ACCESO",
];
