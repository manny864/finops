/**
 * Cliente compartido de Azure Blob Storage — reemplaza el filesystem local
 * (montado como volumen Docker) para los adjuntos de soporte y los logos de
 * tenant, cada uno en su propio container.
 *
 * Env var requerida: AZURE_STORAGE_CONNECTION_STRING (ver
 * src/lib/secrets/infraSecrets.ts para la resolución híbrida vía Key
 * Vault). Si no está configurada, isBlobStorageEnabled() devuelve false y
 * los callers (src/lib/tenantLogo.ts, src/lib/supportAttachments.ts) caen
 * a filesystem local — mismo patrón híbrido que ya usa el resto del código
 * (Key Vault -> env var, DefaultAzureCredential -> fallback, etc.), para no
 * requerir un Storage Account real en cada entorno de desarrollo.
 *
 * Containers privados (sin acceso público anónimo): SIEMPRE se sirven a
 * través de nuestras propias API routes, nunca con una URL directa de blob.
 */
import { BlobServiceClient, ContainerClient } from "@azure/storage-blob";
import { errorMessage, errorStatus } from '@/lib/apiErrors';

let serviceClientSingleton: BlobServiceClient | null = null;
const containerClients = new Map<string, ContainerClient>();

export function isBlobStorageEnabled(): boolean {
  return !!process.env.AZURE_STORAGE_CONNECTION_STRING;
}

function getServiceClient(): BlobServiceClient {
  if (serviceClientSingleton) return serviceClientSingleton;
  const conn = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (!conn) throw new Error("AZURE_STORAGE_CONNECTION_STRING no está configurado.");
  serviceClientSingleton = BlobServiceClient.fromConnectionString(conn);
  return serviceClientSingleton;
}

async function getContainerClient(containerName: string): Promise<ContainerClient> {
  const cached = containerClients.get(containerName);
  if (cached) return cached;
  const client = getServiceClient().getContainerClient(containerName);
  // access: undefined = privado (sin lectura anónima). Idempotente.
  await client.createIfNotExists();
  containerClients.set(containerName, client);
  return client;
}

export async function uploadBlob(
  containerName: string,
  blobName: string,
  bytes: Buffer,
  contentType: string
): Promise<void> {
  const container = await getContainerClient(containerName);
  const blockBlob = container.getBlockBlobClient(blobName);
  await blockBlob.uploadData(bytes, {
    blobHTTPHeaders: { blobContentType: contentType },
  });
}

/**
 * Devuelve null si el blob no existe (404), en vez de tirar. Cualquier OTRO
 * error (DNS, auth, red, permisos) SÍ se relanza: para callers como la ingesta
 * de costos, confundir "storage inalcanzable" con "no hay datos" falsearía las
 * cifras en silencio. Los callers que sirven un asset opcional deben usar
 * `downloadBlobOrNull`.
 */
export async function downloadBlob(containerName: string, blobName: string): Promise<Buffer | null> {
  try {
    const container = await getContainerClient(containerName);
    const blockBlob = container.getBlockBlobClient(blobName);
    return await blockBlob.downloadToBuffer();
  } catch (e) {
    if (errorStatus(e) === 404) return null;
    throw e;
  }
}

/**
 * Igual que downloadBlob pero nunca lanza: devuelve null ante CUALQUIER fallo,
 * dejando rastro en el log.
 *
 * Para assets opcionales (logo de tenant, avatar, adjuntos), donde el llamador
 * ya trata null como "no disponible" y un fallo de infraestructura no debe
 * romper la página. Sin esto, un storage account que no resuelve por DNS
 * convertía cada `<img>` de logo en un 500 en todas las cargas de página.
 */
export async function downloadBlobOrNull(
  containerName: string,
  blobName: string,
  context: string
): Promise<Buffer | null> {
  try {
    return await downloadBlob(containerName, blobName);
  } catch (e) {
    console.error(`[blob] ${context}: no se pudo bajar ${containerName}/${blobName}:`, errorMessage(e));
    return null;
  }
}

/** Best-effort: no lanza si el blob ya no existe. */
export async function deleteBlob(containerName: string, blobName: string): Promise<void> {
  const container = await getContainerClient(containerName);
  await container.getBlockBlobClient(blobName).deleteIfExists();
}

/** Lista los nombres de los blobs en un contenedor filtrando opcionalmente por prefijo. */
export async function listBlobs(containerName: string, prefix?: string): Promise<string[]> {
  try {
    const container = await getContainerClient(containerName);
    const names: string[] = [];
    for await (const blob of container.listBlobsFlat({ prefix })) {
      names.push(blob.name);
    }
    return names;
  } catch (e) {
    if (errorStatus(e) === 404) return [];
    throw e;
  }
}

/** Test helper. No usar en runtime. */
export function _resetForTests(): void {
  serviceClientSingleton = null;
  containerClients.clear();
}
