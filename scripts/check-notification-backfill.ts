/**
 * ¿Se puede retraducir una notificación histórica?
 *
 * Las filas anteriores a la migración 20260908-001 tienen `title_key IS NULL` y
 * sólo guardan la frase en castellano. La pregunta que decide si conviene un
 * backfill no es "¿se puede parsear el texto?" sino otra, más estricta:
 *
 *     ¿la clave de hoy, con los parámetros que se saquen del texto viejo,
 *      reproduce EXACTAMENTE ese texto viejo?
 *
 * Si no lo reproduce, la clave modela menos información que la fila, y escribir
 * `title_key`/`message_key` no traduciría la notificación: le borraría contenido.
 * Por eso esto no escribe nada. Sólo mide y explica.
 *
 *     DB_PORT=3307 npx tsx scripts/check-notification-backfill.ts
 *
 * Si algún día las claves crecen hasta cubrir todo lo que la fila trae, este
 * script pasa a decir "reproduce" y ahí sí el backfill es seguro.
 */
import { createTranslator } from "next-intl";
import { readFileSync } from "fs";
import pool from "@/modules/storage/db";

const es = JSON.parse(readFileSync("messages/es.json", "utf8"));
const t = createTranslator({ locale: "es", messages: es, namespace: "Notifications" }) as unknown as (
    k: string,
    v?: Record<string, string | number>
) => string;

/**
 * Cada patrón sabe reconocer un título generado y sacarle los parámetros. El
 * título alcanza para identificar la fila; el mensaje se compara aparte porque
 * es donde están las diferencias interesantes.
 */
const PATRONES: Array<{
    fuente: string;
    re: RegExp;
    claveTitulo: string;
    claveMensaje: string;
    params: (m: RegExpMatchArray, mensaje: string) => Record<string, string | number>;
}> = [
    {
        fuente: "anomaly_detection",
        re: /^🚨 Anomalía de gasto — \$(\d+(?:[.,]\d+)?) el (\d{4}-\d{2}-\d{2})$/,
        claveTitulo: "notif_anomaly_title",
        claveMensaje: "notif_anomaly_msg",
        params: (m, mensaje) => {
            // Los cuantificadores no se comen el punto final de la frase: si lo
            // hicieran, el render saldria con dos puntos y el informe exageraria
            // la diferencia culpando al catalogo de un error del parser.
            const esp = mensaje.match(/Promedio esperado: \$(\d+(?:[.,]\d+)?)/);
            const z = mensaje.match(/Z-Score: (\d+(?:[.,]\d+)?)/);
            return { amount: m[1], date: m[2], expected: esp?.[1] ?? "", zScore: z?.[1] ?? "" };
        },
    },
    {
        fuente: "executive-report",
        re: /^Reporte ejecutivo listo$/,
        claveTitulo: "notif_report_ready_title",
        claveMensaje: "notif_report_ready_msg",
        params: (_m, mensaje) => ({ scope: mensaje.match(/reporte ejecutivo para (.+?) ya está/)?.[1] ?? "" }),
    },
    {
        fuente: "executive-report",
        re: /^Fallo al generar reporte ejecutivo$/,
        claveTitulo: "notif_report_failed_title",
        claveMensaje: "notif_report_failed_msg",
        params: (_m, mensaje) => ({ scope: mensaje.match(/reporte para (.+?)\.$/)?.[1] ?? "" }),
    },
    {
        fuente: "executive-report",
        re: /^Reporte Ejecutivo FinOps Compilado$/,
        claveTitulo: "notif_report_compiled_title",
        claveMensaje: "notif_report_compiled_msg",
        params: () => ({}),
    },
];

function render(clave: string, params: Record<string, string | number>): string {
    try {
        return t(clave, params);
    } catch (e) {
        return `<<error: ${(e as Error).message}>>`;
    }
}

(async () => {
    const [filas]: any = await pool.query(
        `SELECT id, source, title, message FROM Notifications WHERE title_key IS NULL ORDER BY id`
    );

    let reproducibles = 0;
    let soloTitulo = 0;
    let sinPatron = 0;

    for (const f of filas) {
        const p = PATRONES.find((x) => x.fuente === f.source && x.re.test(f.title));
        if (!p) {
            sinPatron++;
            console.log(`#${f.id} SIN PATRON      "${f.title}"`);
            continue;
        }

        const params = p.params(f.title.match(p.re)!, f.message);
        const titulo = render(p.claveTitulo, params);
        const mensaje = render(p.claveMensaje, params);

        const tituloOk = titulo === f.title;
        const mensajeOk = mensaje === f.message;

        if (tituloOk && mensajeOk) {
            reproducibles++;
            console.log(`#${f.id} REPRODUCE`);
            continue;
        }
        soloTitulo++;
        console.log(`#${f.id} PIERDE CONTENIDO`);
        if (!tituloOk) console.log(`     titulo  guardado: ${f.title}\n     titulo  con clave: ${titulo}`);
        if (!mensajeOk) {
            console.log(`     mensaje guardado: ${JSON.stringify(f.message.slice(0, 120))}`);
            console.log(`     mensaje con clave: ${JSON.stringify(mensaje.slice(0, 120))}`);
        }
    }

    console.log(
        `\nRESUMEN  ${filas.length} filas sin clave: ` +
            `${reproducibles} reproducibles, ${soloTitulo} pierden contenido, ${sinPatron} sin patron.`
    );
    console.log(
        reproducibles === filas.length
            ? "El backfill es seguro: las claves de hoy reproducen el texto guardado."
            : "El backfill NO es seguro: escribir las claves borraria lo que la clave no modela."
    );

    await pool.end();
})();
