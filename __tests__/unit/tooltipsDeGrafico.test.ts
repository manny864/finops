import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

/**
 * Todo tooltip de Recharts tiene que decidir sus colores por tema.
 *
 * Recharts pinta el tooltip con fondo blanco fijo y le da a cada item el color
 * de su serie. Sin estilo propio eso queda ilegible en oscuro; con un estilo
 * hardcodeado --el par `#1B2A41` + `#FFFFFF` que habia en 17 archivos-- queda
 * una pastilla oscura tambien en modo claro, que es lo contrario de lo pedido:
 * en claro va blanco con texto azul de marca, en oscuro oscuro con texto blanco.
 *
 * Las dos formas validas son `TOOLTIP_TEMA` (src/lib/chartTooltip.ts, que
 * apunta a --surface/--line/--chart-tip-fg) y el helper `chart.tooltip` de
 * src/lib/chartTheme.ts. Cualquier otra cosa es un color que no sabe en que
 * tema esta.
 *
 * Lo que este test NO puede afirmar: que las variables CSS tengan los valores
 * correctos en cada tema. Eso vive en globals.css y se mira con los ojos.
 */

const RAIZ = "src";
const VALIDOS = ["TOOLTIP_TEMA", "chart.tooltip"];

function recorrer(dir: string, salida: string[] = []): string[] {
    for (const entrada of readdirSync(dir)) {
        const p = join(dir, entrada);
        if (statSync(p).isDirectory()) {
            if (entrada !== "node_modules" && entrada !== ".next") recorrer(p, salida);
        } else if (entrada.endsWith(".tsx")) {
            salida.push(p);
        }
    }
    return salida;
}

/**
 * Cierre de la etiqueta respetando llaves y comillas: un `>` dentro de una
 * arrow function (`formatter={(v) => ...}`) no cierra nada.
 */
function finDeEtiqueta(src: string, desde: number): number {
    let llaves = 0;
    let comilla: string | null = null;
    for (let k = desde; k < src.length; k++) {
        const c = src[k];
        const previo = src[k - 1];
        if (comilla) {
            if (c === comilla && previo !== "\\") comilla = null;
            continue;
        }
        if (c === '"' || c === "'" || c === "`") {
            comilla = c;
            continue;
        }
        if (c === "{") llaves++;
        else if (c === "}") llaves--;
        else if (c === ">" && llaves === 0) return k;
    }
    return -1;
}

function escanear() {
    const sinTema: { archivo: string; fragmento: string }[] = [];
    let total = 0;

    for (const archivo of recorrer(RAIZ)) {
        const src = readFileSync(archivo, "utf8");
        let i = 0;
        while (true) {
            // `(?![A-Za-z])` excluye a InfoTooltip, que es el globo de ayuda
            // "(i)" y no un tooltip de grafico.
            const m = /<(Recharts)?Tooltip(?![A-Za-z])/.exec(src.slice(i));
            if (!m) break;
            const ini = i + m.index;
            const fin = finDeEtiqueta(src, ini);
            if (fin === -1) {
                i = ini + 1;
                continue;
            }
            const etiqueta = src.slice(ini, fin + 1);
            total++;
            if (!VALIDOS.some((v) => etiqueta.includes(v))) {
                sinTema.push({
                    archivo,
                    fragmento: etiqueta.replace(/\s+/g, " ").slice(0, 90),
                });
            }
            i = fin + 1;
        }
    }
    return { sinTema, total };
}

describe("tooltips de grafico: el color lo decide el tema", () => {
    const { sinTema, total } = escanear();

    it("todo <Tooltip> de Recharts usa TOOLTIP_TEMA o el helper chart.tooltip", () => {
        const reporte = sinTema.map((s) => `  ${s.archivo}\n    ${s.fragmento}`).join("\n");
        expect(
            sinTema.length,
            sinTema.length
                ? `\n${sinTema.length} tooltip(s) de grafico sin tema.\n` +
                  `En claro va blanco con texto azul; en oscuro, oscuro con texto blanco.\n` +
                  `Agregale {...TOOLTIP_TEMA} (src/lib/chartTooltip.ts).\n${reporte}\n`
                : ""
        ).toBe(0);
    });

    it("el escaneo encuentra los tooltips", () => {
        // Red de seguridad del propio test: si la regex deja de matchear, el
        // conteo se desploma y el test pasaria vacio dando falsa tranquilidad.
        expect(total).toBeGreaterThan(80);
    });
});
