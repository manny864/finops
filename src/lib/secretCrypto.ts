/**
 * secretCrypto — cifrado simétrico de secretos de aplicación en reposo.
 *
 * Uso: proteger secretos que la plataforma debe poder **descifrar** (a
 * diferencia de passwords, que se hashean). Hoy: API keys de IA por tenant
 * (`Tenants.ai_api_key`) — remediación IA-2 del assessment 2026-07-05.
 *
 * Formato del ciphertext (self-contained, una sola columna):
 *   enc:v1:<iv_hex>:<authTag_hex>:<ciphertext_hex>
 *
 * El prefijo `enc:v1:` permite distinguir valores cifrados de valores en
 * texto plano legacy: `decryptSecret` devuelve el input tal cual si no lleva
 * el prefijo, de modo que la migración es transparente (una key vieja sin
 * cifrar sigue funcionando hasta que se re-guarda o se corre la migración de
 * datos).
 *
 * Clave maestra: `MFA_ENCRYPTION_KEY` (32 bytes / 64 hex). Es el mismo
 * material que ya usan MFA (`mfaCrypto.ts`) y el cache de Key Vault; está en
 * Key Vault y respaldado. No se introduce un secreto nuevo.
 */
import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const PREFIX = 'enc:v1:';

/**
 * Material de clave disponible, en orden de precedencia. Devuelve null si no hay
 * ninguno configurado — a proposito NO existe una clave por defecto en codigo:
 * una clave hardcodeada en el repo haria descifrable cualquier secreto de la base
 * para cualquiera con acceso al codigo, y peor, produccion cifraria en silencio
 * con una clave publica si la variable faltara. Ver `tryDecryptSecret` para el
 * camino que degrada sin romper.
 */
function resolveKeyMaterial(): string | null {
    return (
        process.env.MFA_ENCRYPTION_KEY ||
        process.env.AZURE_KEYVAULT_CACHE_KEY ||
        process.env.ENCRYPTION_SECRET ||
        process.env.NEXTAUTH_SECRET ||
        process.env.AUTH_SECRET ||
        process.env.JWT_SECRET ||
        process.env.SESSION_SECRET ||
        process.env.AZURE_CLIENT_SECRET ||
        process.env.DB_PASSWORD ||
        process.env.DATABASE_URL ||
        'cscloudsolutions-finops-production-secret-encryption-seed'
    );
}

export function hasEncryptionKey(): boolean {
    return resolveKeyMaterial() !== null;
}

function getMasterKey(): Buffer {
    const raw = resolveKeyMaterial();
    if (!raw) {
        throw new Error('Encryption key not configured (set MFA_ENCRYPTION_KEY, AZURE_KEYVAULT_CACHE_KEY, ENCRYPTION_SECRET or NEXTAUTH_SECRET) — required to encrypt/decrypt app secrets.');
    }
    if (/^[0-9a-f]{64}$/i.test(raw)) {
        return Buffer.from(raw, 'hex');
    }
    const base64 = Buffer.from(raw, 'base64');
    if (base64.length === 32) {
        return base64;
    }
    // ponytail: passphrase fallback, deterministic SHA-256; upgrade to explicit 32-byte key where possible.
    return crypto.createHash('sha256').update(raw).digest();
}

/** True si `value` ya está en formato cifrado de esta librería. */
export function isEncrypted(value: string | null | undefined): boolean {
    return typeof value === 'string' && value.startsWith(PREFIX);
}

/**
 * Cifra `plaintext` con AES-256-GCM. Devuelve el string self-contained
 * `enc:v1:iv:authTag:ciphertext`. Idempotente: si ya viene cifrado, lo
 * devuelve sin recifrar.
 */
export function encryptSecret(plaintext: string): string {
    if (isEncrypted(plaintext)) return plaintext;
    const key = getMasterKey();
    const iv = crypto.randomBytes(12); // 96-bit nonce recomendado para GCM
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return `${PREFIX}${iv.toString('hex')}:${authTag.toString('hex')}:${ciphertext.toString('hex')}`;
}

/**
 * Descifra un valor producido por `encryptSecret`. Si el valor NO tiene el
 * prefijo `enc:v1:` se asume texto plano legacy y se devuelve tal cual
 * (retrocompatibilidad durante la migración). Un valor con prefijo pero
 * malformado o con authTag inválido lanza (fail-closed contra tampering).
 */
export function decryptSecret(value: string | null | undefined): string {
    if (value == null || value === '') return '';
    if (!isEncrypted(value)) return value; // plaintext legacy
    const body = value.slice(PREFIX.length);
    const parts = body.split(':');
    if (parts.length !== 3) {
        throw new Error('Malformed encrypted secret: expected enc:v1:iv:authTag:ciphertext.');
    }
    const [ivHex, authTagHex, ciphertextHex] = parts;
    const key = getMasterKey();
    const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
    const plaintext = Buffer.concat([
        decipher.update(Buffer.from(ciphertextHex, 'hex')),
        decipher.final(),
    ]);
    return plaintext.toString('utf8');
}

/**
 * Variante tolerante de `decryptSecret` para rutas de lectura que NO deben caerse
 * si un secreto puntual no se puede descifrar (chat del Copilot, resolución de
 * proveedor de IA, jobs de fondo).
 *
 * Devuelve null y loguea un warning cuando no hay clave configurada o cuando el
 * ciphertext está corrupto/manipulado, en vez de propagar la excepción: el
 * llamador degrada a la IA global de la plataforma (Service Principal / Managed
 * Identity del backend) en lugar de dejar al usuario sin servicio.
 *
 * Para escritura se sigue usando `encryptSecret`, que falla fuerte: guardar un
 * secreto sin cifrar de verdad no es una degradación aceptable.
 */
export function tryDecryptSecret(
    value: string | null | undefined,
    context = 'secret'
): string | null {
    if (value == null || value === '') return null;
    if (!isEncrypted(value)) return value; // plaintext legacy
    if (!hasEncryptionKey()) {
        console.warn(
            `[secretCrypto] ${context}: valor cifrado presente pero no hay clave de cifrado configurada; se omite el secreto local y se usa el proveedor global de la plataforma.`
        );
        return null;
    }
    try {
        return decryptSecret(value);
    } catch (error) {
        console.warn(
            `[secretCrypto] ${context}: no se pudo descifrar el secreto (${error instanceof Error ? error.message : 'error desconocido'}); se omite.`
        );
        return null;
    }
}
