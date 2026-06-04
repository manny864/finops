import { DefaultAzureCredential } from "@azure/identity";
import { SecretClient } from "@azure/keyvault-secrets";

export async function getTenantSecret(tenantId: string): Promise<string> {
  const vaultName = process.env.KEYVAULT_NAME;
  const fallbackSecret = process.env.AZURE_CLIENT_SECRET;

  if (!vaultName) {
    if (fallbackSecret) {
        console.warn(`[KeyVault] KEYVAULT_NAME no definido. Usando AZURE_CLIENT_SECRET de respaldo para el tenant ${tenantId}.`);
        return fallbackSecret;
    }
    throw new Error("Se requiere la variable KEYVAULT_NAME o AZURE_CLIENT_SECRET para autenticar el Tenant.");
  }
  
  const url = `https://${vaultName}.vault.azure.net`;
  
  try {
    const credential = new DefaultAzureCredential();
    const client = new SecretClient(url, credential);
    const secretName = `client-secret-${tenantId}`;
    
    const secret = await client.getSecret(secretName);
    if (!secret.value) throw new Error(`El secreto ${secretName} no tiene valor.`);
    return secret.value;
  } catch (error: any) {
    // Fallback híbrido: Si el Key Vault falla (ej. localhost sin permisos), intenta usar el .env
    if (fallbackSecret) {
        console.warn(`[KeyVault] Falló conexión a ${vaultName} (${error.message}). Usando AZURE_CLIENT_SECRET de respaldo.`);
        return fallbackSecret;
    }
    throw new Error(`Fallo al recuperar el secreto para el tenant ${tenantId} y no hay secreto de respaldo: ${error.message}`);
  }
}
