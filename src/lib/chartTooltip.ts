/**
 * Estilo unico para los tooltips de Recharts.
 *
 * Recharts renderiza el tooltip con un fondo blanco fijo y pinta el texto de
 * cada item con el color de su serie. En modo oscuro eso daba texto claro sobre
 * fondo claro: ilegible. Las variables de `globals.css` ya cambian solas
 * (`--surface` #FFFFFF -> #0A1728, `--ink` #1B2A41 -> #EEF3F9), asi que alcanza
 * con apuntar a ellas.
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
        color: "var(--ink)",
    },
    itemStyle: { color: "var(--ink)" },
    labelStyle: { color: "var(--ink)", fontWeight: 600 },
} as const;
