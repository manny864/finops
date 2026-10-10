/**
 * Memoiza UNA ejecución asíncrona: todos los llamadores comparten la misma promesa.
 *
 * Sirve para lo que se calcula una vez por request aunque lo pida cada iteración de un bucle (p. ej.
 * una consulta a MySQL que no depende de la clave que se está procesando). Si falla, no se guarda el
 * error: el siguiente llamador vuelve a intentar.
 */
export function asyncOnce<T>(fn: () => Promise<T>): () => Promise<T> {
    let pendiente: Promise<T> | null = null;
    return () => {
        if (!pendiente) {
            // `new Promise` convierte también un throw síncrono de `fn` en un rechazo.
            pendiente = new Promise<T>((resolver) => resolver(fn())).catch((e) => {
                pendiente = null;
                throw e;
            });
        }
        return pendiente;
    };
}
