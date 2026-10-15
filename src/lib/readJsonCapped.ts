/**
 * AISEC-06: lee un body JSON cortando en `maxBytes` mientras llega, no después de
 * tenerlo entero en memoria (`request.json()` no tiene tope). Rechaza de entrada si
 * el Content-Length declarado ya lo supera; si falta o miente, corta el stream.
 */
export class BodyLimitError extends Error {
    constructor(readonly status: 400 | 413, message: string) {
        super(message);
    }
}

export async function readJsonCapped(request: Request, maxBytes: number): Promise<unknown> {
    const declared = Number(request.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > maxBytes) throw new BodyLimitError(413, "Payload demasiado grande.");
    if (!request.body) throw new BodyLimitError(400, "Body vacío.");

    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
            await reader.cancel().catch(() => {});
            throw new BodyLimitError(413, "Payload demasiado grande.");
        }
        chunks.push(value);
    }
    try {
        return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
        throw new BodyLimitError(400, "JSON inválido.");
    }
}
