"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";

/**
 * Paleta de gráficas (Recharts) por tema.
 *
 * Recharts recibe los colores de ejes, grid y series como props SVG (`stroke`,
 * `fill`), donde las clases `dark:` de Tailwind no aplican: hay que resolver el
 * tema en JS. Esto centraliza los tokens para no repetir el chequeo en cada
 * gráfica y para que el contraste en modo oscuro no dependa de cada autor.
 *
 * Tokens según la directiva de diseño corporativo: azul empresarial en claro,
 * cian de alto contraste en oscuro, y grid/etiquetas en slate legible.
 */
export interface ChartTheme {
  isDark: boolean;
  /** `false` cuando conviene que Recharts renderice el frame final directo, sin
   *  animar la entrada. Ver `computeAnimate` para las dos razones. */
  animate: boolean;
  /** Serie principal (barras, líneas, radar). */
  accent: string;
  /** Serie secundaria / proyección. */
  accentSoft: string;
  /** Líneas de grid cartesiano o polar. */
  grid: string;
  /** Texto de ticks de ejes y etiquetas de dominio. */
  tick: string;
  /** Eje / línea base. */
  axis: string;
  /** Estilo del tooltip de Recharts. */
  tooltip: { backgroundColor: string; color: string; borderColor: string };
}

const LIGHT: Omit<ChartTheme, "isDark" | "animate"> = {
  accent: "#0078D4",
  accentSoft: "#2563EB",
  grid: "#E2E8F0",
  tick: "#1B2A41",
  axis: "#94A3B8",
  tooltip: { backgroundColor: "#1B2A41", color: "#FFFFFF", borderColor: "#1B2A41" },
};

const DARK: Omit<ChartTheme, "isDark" | "animate"> = {
  accent: "#38BDF8",
  accentSoft: "#7DD3FC",
  grid: "#334155",
  tick: "#CBD5E1",
  axis: "#475569",
  tooltip: { backgroundColor: "#0F172A", color: "#FFFFFF", borderColor: "#334155" },
};

/**
 * MEJ-02: Recharts anima la entrada de cada serie sobre `requestAnimationFrame`.
 * El navegador PAUSA ese ciclo en pestañas en segundo plano; si el gráfico se
 * monta mientras la pestaña está oculta, la animación queda congelada en el
 * frame 0 (todo en el centro/radio 0) y no hay forma de "despertarla" sin
 * recargar. `prefers-reduced-motion` es la segunda razón, independiente de la
 * visibilidad: el usuario pidió explícitamente no ver movimiento.
 *
 * Se evalúa una sola vez por render inicial (no reactivo a cambios de pestaña
 * después de montado): el bug reportado es "cargó oculto", no "se ocultó a
 * mitad de la animación" — ese caso residual es cosmético (la serie queda a
 * medio animar) y no repite el bug real (que la serie no aparezca nunca).
 * Agregar un listener de `visibilitychange` para ese caso residual es la
 * mejora que sigue si se reporta.
 */
export function computeInitialAnimate(): boolean {
  if (typeof document === "undefined") return true; // SSR: no se usa (mounted lo tapa), valor irrelevante.
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return false;
  return document.visibilityState === "visible";
}

export function useChartTheme(): ChartTheme {
  const { resolvedTheme } = useTheme();
  // El tema sólo es confiable tras montar: en SSR `resolvedTheme` es undefined y
  // usarlo en el primer render provoca hydration mismatch. `animate` viaja en el
  // mismo gate por la misma razón (SSR no tiene `document`/`matchMedia`) y de
  // paso evita que la primera pintada en el cliente reciba `true` (default de
  // Recharts) y luego salte a `false` -- se resuelve ANTES del primer paint
  // visible del cliente, en el mismo `useEffect` que ya existía.
  const [mounted, setMounted] = useState(false);
  const [animate, setAnimate] = useState(true);
  useEffect(() => {
    setMounted(true);
    setAnimate(computeInitialAnimate());
  }, []);

  const isDark = mounted && resolvedTheme === "dark";
  return { isDark, animate: mounted ? animate : true, ...(isDark ? DARK : LIGHT) };
}
