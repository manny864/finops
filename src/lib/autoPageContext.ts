/**
 * Captura automática del contexto de la página activa para el FinOps Copilot.
 *
 * Antes de esto, el Copilot solo "veía" datos en las ~2 páginas que llamaban
 * manualmente a `setPageContext` (useAIContext) — en el resto quedaba ciego:
 * `currentDataPayload` era `null` y el auto-reporte al abrir el panel nunca
 * se disparaba. Esto le da un fallback genérico que funciona en cualquier
 * página sin cablear cada una a mano: lee el DOM ya renderizado dentro de
 * `<main>` (el layout raíz — `ClientShell` — ya aísla ahí el contenido de la
 * página, fuera del sidebar/topbar/el propio widget del Copilot) y arma un
 * texto plano acotado que se manda como `dataPayload`.
 *
 * Seguridad: este texto viaja SIEMPRE dentro de `<context_data>` en el
 * endpoint (`/api/intelligence/copilot`), que ya trata ese bloque como datos
 * NO confiables (ver IA-3 en route.ts) — no cambia el modelo de amenaza
 * existente, solo alimenta el mismo canal que antes requería wiring manual.
 */

const MAX_SNAPSHOT_LENGTH = 6000;

/** Locales soportados (next-intl) — se usan para no mostrar el segmento de
 *  idioma como si fuera parte del nombre de la página. */
const KNOWN_LOCALES = new Set(["es", "en", "pt-BR"]);

/**
 * Extrae texto legible del contenedor `<main>` de la página activa,
 * limpiando ruido (scripts, iconos SVG, elementos ocultos) y acotando la
 * longitud para no inflar tokens de entrada del modelo.
 *
 * Debe ejecutarse solo en cliente (browser). Devuelve `""` si no hay DOM
 * disponible o no se encontró contenido útil.
 */
export function captureAutoPageSnapshot(): string {
  if (typeof document === "undefined") return "";

  const main = document.querySelector("main");
  if (!main) return "";

  let clone: HTMLElement;
  try {
    clone = main.cloneNode(true) as HTMLElement;
  } catch {
    return "";
  }

  clone
    .querySelectorAll("script, style, svg, iframe, noscript, [aria-hidden='true']")
    .forEach((el) => el.remove());

  const raw = clone.innerText || clone.textContent || "";
  const text = raw
    .replace(/\r/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (!text) return "";
  return text.length > MAX_SNAPSHOT_LENGTH
    ? text.slice(0, MAX_SNAPSHOT_LENGTH) + "…"
    : text;
}

/**
 * Deriva una etiqueta legible del módulo activo a partir del pathname
 * (`/es/intelligence/rightsizing` → "Intelligence › Rightsizing"), para usar
 * como `pageContext` cuando la página no llamó a `setPageContext` con un
 * nombre propio.
 */
export function deriveLabelFromPathname(pathname: string | null | undefined): string {
  if (!pathname) return "Página actual";
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length > 0 && KNOWN_LOCALES.has(segments[0])) {
    segments.shift();
  }
  if (segments.length === 0) return "Inicio";
  const labels = segments.map((seg) =>
    seg
      .replace(/[-_]/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase())
  );
  return labels.join(" › ");
}
