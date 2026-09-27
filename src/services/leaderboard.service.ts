/**
 * MEJ-37 — el ranking de equipos, y por qué NO se ordena por gasto.
 *
 * Un ranking por gasto absoluto premia al equipo chico y castiga al que corre
 * producción: el primer puesto se lo lleva siempre el que menos tiene a cargo,
 * haga lo que haga. No mide comportamiento, mide tamaño.
 *
 * Se ordena por MEJORA — cuánto bajó cada grupo contra el período anterior—,
 * que sí es algo que el equipo controla.
 *
 * Todo lo de este archivo es puro: recibe los números ya sumados y decide el
 * orden. Así el criterio se puede discutir y probar sin base de datos.
 */

/** Un grupo que no llega a este porcentaje del gasto total no se rankea. */
export const UMBRAL_MATERIALIDAD_PCT = 1;

export type Clasificacion = "COGS" | "OPEX" | "UNCLASSIFIED";

export interface EntradaDeGrupo {
    grupo: string;
    gasto: number;
    /** `null` cuando no hay período anterior con el que comparar. */
    gastoPrevio: number | null;
    presupuesto: number | null;
    ahorroCapturado: number;
    clasificacion: Clasificacion;
}

/** Por qué una fila quedó fuera del ranking. `null` = está rankeada. */
export type MotivoSinRanking = "sin-periodo-previo" | "no-material";

export interface FilaDelRanking extends EntradaDeGrupo {
    puesto: number | null;
    variacionPct: number | null;
    /** Cuánto del presupuesto lleva consumido. `null` si no tiene. */
    adherenciaPct: number | null;
    sinRanking: MotivoSinRanking | null;
}

export interface Leaderboard {
    filas: FilaDelRanking[];
    /** El criterio, para escribirlo en pantalla. Criterio de aceptación 1. */
    criterio: {
        ordenadoPor: "mejora";
        descripcion: string;
        umbralMaterialidadPct: number;
    };
    split: {
        COGS: number;
        OPEX: number;
        UNCLASSIFIED: number;
        total: number;
    };
}

function pct(actual: number, previo: number): number {
    // Un grupo que antes no gastaba y ahora sí no es "infinito por ciento": es
    // un grupo nuevo, y se trata como tal más arriba.
    if (previo === 0) return actual === 0 ? 0 : 100;
    return ((actual - previo) / previo) * 100;
}

/**
 * Arma el ranking.
 *
 * DOS COSAS QUE NO SON OBVIAS Y ESTÁN EN LOS TESTS:
 *
 * 1. **Un grupo sin período anterior no se rankea.** No es que mejoró ni que
 *    empeoró: no hay contra qué compararlo. Ponerlo primero lo premiaría por
 *    haber nacido, y ponerlo último lo castigaría por lo mismo. Aparece en la
 *    tabla, marcado, fuera del orden.
 *
 * 2. **Un grupo por debajo del umbral de materialidad tampoco.** Sin esto, un
 *    grupo que pasó de 1 a 0,50 dólares muestra −50% y le gana al equipo que
 *    recortó 50.000 con un −10%. El ranking premiaría al ruido. El umbral es
 *    relativo al gasto del tenant y va en la respuesta para que la pantalla lo
 *    pueda decir, en vez de ser una constante escondida.
 */
export function armarLeaderboard(entradas: EntradaDeGrupo[]): Leaderboard {
    const total = entradas.reduce((a, e) => a + e.gasto, 0);
    const piso = (total * UMBRAL_MATERIALIDAD_PCT) / 100;

    const filas: FilaDelRanking[] = entradas.map((e) => {
        const variacionPct = e.gastoPrevio === null ? null : Number(pct(e.gasto, e.gastoPrevio).toFixed(2));
        let sinRanking: MotivoSinRanking | null = null;
        if (e.gastoPrevio === null) sinRanking = "sin-periodo-previo";
        else if (e.gasto < piso && e.gastoPrevio < piso) sinRanking = "no-material";

        return {
            ...e,
            variacionPct,
            // El presupuesto se informa aunque no exista: criterio 2, el grupo
            // aparece con la columna vacía y no excluido.
            adherenciaPct:
                e.presupuesto && e.presupuesto > 0
                    ? Number(((e.gasto / e.presupuesto) * 100).toFixed(1))
                    : null,
            sinRanking,
            puesto: null,
        };
    });

    // El orden: primero la mayor caída porcentual; a igual variación, el que
    // más ahorro capturó. Las dos miran comportamiento, no tamaño.
    const rankeables = filas.filter((f) => !f.sinRanking);
    rankeables.sort(
        (a, b) => (a.variacionPct! - b.variacionPct!) || (b.ahorroCapturado - a.ahorroCapturado)
    );
    rankeables.forEach((f, i) => { f.puesto = i + 1; });

    const fuera = filas.filter((f) => f.sinRanking).sort((a, b) => b.gasto - a.gasto);

    const split = { COGS: 0, OPEX: 0, UNCLASSIFIED: 0, total: Number(total.toFixed(2)) };
    for (const f of filas) split[f.clasificacion] += f.gasto;
    split.COGS = Number(split.COGS.toFixed(2));
    split.OPEX = Number(split.OPEX.toFixed(2));
    split.UNCLASSIFIED = Number(split.UNCLASSIFIED.toFixed(2));

    return {
        filas: [...rankeables, ...fuera],
        criterio: {
            ordenadoPor: "mejora",
            descripcion:
                "Ordenado por la baja porcentual del gasto contra el período anterior; " +
                "a igual variación, por ahorro capturado. No por gasto: un ranking por " +
                "gasto absoluto premia al equipo chico y castiga al que corre producción.",
            umbralMaterialidadPct: UMBRAL_MATERIALIDAD_PCT,
        },
        split,
    };
}
