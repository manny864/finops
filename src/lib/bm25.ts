/**
 * BM25 (Okapi) en memoria y sin dependencias, para buscar en el índice de
 * manuales de los borradores de soporte (Fase 3b). El corpus son unos cientos
 * de chunks: no hace falta un motor de búsqueda.
 */

const K1 = 1.2;
const B = 0.75;

/** Minúsculas y sin tildes, para que "suscripción" y "suscripcion" sean el mismo término. */
export function tokenize(text: string): string[] {
    return text
        .normalize("NFD")
        .replace(/\p{M}/gu, "")
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter(Boolean);
}

// Los términos de una letra son artículos y conjunciones: no discriminan.
const terms = (text: string) => tokenize(text).filter((t) => t.length > 1);

export interface Bm25Hit<T> {
    doc: T;
    score: number;
}

export function createBm25Index<T>(docs: readonly T[], textOf: (doc: T) => string) {
    const counts = docs.map((doc) => {
        const tf = new Map<string, number>();
        for (const term of terms(textOf(doc))) tf.set(term, (tf.get(term) ?? 0) + 1);
        return tf;
    });
    const lengths = counts.map((tf) => [...tf.values()].reduce((a, b) => a + b, 0));
    const avgLength = lengths.reduce((a, b) => a + b, 0) / (docs.length || 1) || 1;
    const docFreq = new Map<string, number>();
    for (const tf of counts) for (const term of tf.keys()) docFreq.set(term, (docFreq.get(term) ?? 0) + 1);

    return {
        /** Los `limit` documentos con mejor puntaje; sólo los que comparten algún término con la consulta. */
        search(query: string, limit: number): Bm25Hit<T>[] {
            const queryTerms = [...new Set(terms(query))];
            const hits: Bm25Hit<T>[] = [];
            docs.forEach((doc, i) => {
                let score = 0;
                for (const term of queryTerms) {
                    const tf = counts[i].get(term);
                    if (!tf) continue;
                    const df = docFreq.get(term) ?? 0;
                    const idf = Math.log(1 + (docs.length - df + 0.5) / (df + 0.5));
                    score += (idf * tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * lengths[i]) / avgLength));
                }
                if (score > 0) hits.push({ doc, score });
            });
            return hits.sort((a, b) => b.score - a.score).slice(0, limit);
        },
    };
}
