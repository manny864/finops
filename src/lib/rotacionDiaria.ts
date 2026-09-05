/**
 * Reparte el costo de "ir último" en un barrido secuencial.
 *
 * Los barridos por tenant se procesan en serie para no amplificar el 429 de
 * Cost Management. Eso hace que el orden importe: el último de la lista corre
 * con el rate-limit más gastado, y si el barrido tiene un techo de tiempo, es
 * directamente el que se queda sin procesar. Siempre el mismo.
 *
 * Rotando un puesto por día, ese costo se reparte entre todos.
 *
 * VIVE EN `lib/` Y NO EN LA RUTA QUE LA ESTRENÓ
 * Estaba exportada desde `api/cron/sync/route.ts`. Importar una ruta desde otra
 * arrastra su árbol de dependencias entero, y es el mismo anti-patrón que la
 * auditoría 2026-09-04 anotó en SEC-02: un helper atrapado en un archivo de
 * ruta es un helper que el archivo de al lado va a reimplementar mal.
 */
export function rotateDaily<T>(items: T[], day: Date): T[] {
    if (items.length < 2) return items;
    const dayNumber = Math.floor(day.getTime() / 86400000);
    const offset = dayNumber % items.length;
    return [...items.slice(offset), ...items.slice(0, offset)];
}
