/**
 * Descarga un archivo de una ruta protegida de la API.
 *
 * `window.open(url)` y un `<a href>` NO mandan el `Authorization: Bearer` de MSAL (es una cabecera, no una cookie), así que la ruta
 * contesta 401 «No autorizado» y el usuario ve un JSON pelado en una pestaña. Acá se pide con `fetch` y la sesión, y el resultado se
 * baja como archivo. Si la ruta falla, lanza con el mensaje que ella devolvió para que la pantalla lo muestre.
 */
export async function descargarArchivoConSesion(url: string, headers: Record<string, string>, nombre: string): Promise<void> {
    const res = await fetch(url, { headers });
    if (!res.ok) {
        const cuerpo = await res.json().catch(() => null);
        throw new Error(cuerpo?.error || `No se pudo descargar el archivo (HTTP ${res.status}).`);
    }
    const objectUrl = URL.createObjectURL(await res.blob());
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = nombre;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Se libera después de que el navegador tomó el archivo.
    setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
}
