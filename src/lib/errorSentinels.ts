/**
 * Texto exacto que las rutas API devuelven en `json.error` cuando responden 401.
 *
 * Es un token de protocolo, no texto de pantalla. Los fetchers lo envuelven en
 * `new Error(json.error)` y los tableros lo comparan para decidir si muestran la
 * explicacion de sesion vencida o el error crudo.
 *
 * Compararlo contra `t("unauthorized")` parece razonable y esta mal: en ingles
 * `t()` devuelve "Unauthorized." y en portugues "Nao autorizado.", asi que la
 * igualdad solo se cumple en castellano. En los otros dos idiomas la rama nunca
 * entraba y la pantalla mostraba el castellano crudo del servidor. Seis
 * tableros arrastraban ese bug.
 *
 * Vive en su propio archivo, y no en `apiErrors.ts`, porque aquel importa
 * `next/server` y esto lo consumen componentes de cliente.
 */
export const ERROR_401 = "No autorizado.";
