/**
 * Estilo unico para los tooltips de Recharts.
 *
 * Recharts renderiza el tooltip con un fondo blanco fijo y pinta el texto de
 * cada item con el color de su serie. En modo oscuro eso daba texto claro sobre
 * fondo claro: ilegible.
 *
 * El texto NO usa `--ink`: esa variable es el gris-azulado del cuerpo
 * (#1B2A41), y lo que va es el navy. `--chart-tip-fg` existe para eso
 * --var(--navy) en claro, #FFFFFF en oscuro-- y el fondo sale de `--surface`,
 * que ya es blanco en claro y oscuro en oscuro.
 *
 * **Los tres van juntos.** `contentStyle.color` NO llega al texto de los items:
 * Recharts se lo pisa por elemento. Sin `itemStyle` y `labelStyle` el fondo
 * queda oscuro y el texto sigue con el color de la serie, que es justo el caso
 * que se veia mal.
 *
 * Uso:
 *   <Tooltip {...TOOLTIP_TEMA} />
 */
export const TOOLTIP_TEMA = {
    contentStyle: {
        background: "var(--surface)",
        border: "1px solid var(--line)",
        borderRadius: 8,
        fontSize: 12,
        color: "var(--chart-tip-fg)",
    },
    itemStyle: { color: "var(--chart-tip-fg)" },
    labelStyle: { color: "var(--chart-tip-fg)", fontWeight: 600 },
} as const;
