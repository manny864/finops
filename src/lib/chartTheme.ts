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

const LIGHT: Omit<ChartTheme, "isDark"> = {
  accent: "#0078D4",
  accentSoft: "#2563EB",
  grid: "#E2E8F0",
  tick: "#1B2A41",
  axis: "#94A3B8",
  tooltip: { backgroundColor: "#1B2A41", color: "#FFFFFF", borderColor: "#1B2A41" },
};

const DARK: Omit<ChartTheme, "isDark"> = {
  accent: "#38BDF8",
  accentSoft: "#7DD3FC",
  grid: "#334155",
  tick: "#CBD5E1",
  axis: "#475569",
  tooltip: { backgroundColor: "#0F172A", color: "#FFFFFF", borderColor: "#334155" },
};

export function useChartTheme(): ChartTheme {
  const { resolvedTheme } = useTheme();
  // El tema sólo es confiable tras montar: en SSR `resolvedTheme` es undefined y
  // usarlo en el primer render provoca hydration mismatch.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const isDark = mounted && resolvedTheme === "dark";
  return { isDark, ...(isDark ? DARK : LIGHT) };
}
