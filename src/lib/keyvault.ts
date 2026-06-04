import { DefaultAzureCredential } from "@azure/identity";
import { SecretClient } from "@azure/keyvault-secrets";

export async function getTenantSecret(tenantId: string): Promise<string> {
  const vaultName = process.env.KEYVAULT_NAME;
  if (!vaultName) {
    // Para entornos locales sin key vault, se puede usar un bypass de dev.
    if (process.env.NODE_ENV === 'development' && process.env.AZURE_CLIENT_SECRET) {
      return process.env.AZURE_CLIENT_SECRET;
    }
    throw new Error("KEYVAULT_NAME environment variable is required.");
  }
  
  const url = `https://${vaultName}.vault.azure.net`;
  
  // Utilizamos la identidad gestionada del backend para leer el Key Vault
  const credential = new DefaultAzureCredential();
  const client = new SecretClient(url, credential);

  const secretName = `client-secret-${tenantId}`;
  
  try {
    const secret = await client.getSecret(secretName);
    if (!secret.value) throw new Error(`El secreto ${secretName} no tiene valor.`);
    return secret.value;
  } catch (error: any) {
    throw new Error(`Fallo al recuperar el secreto para el tenant ${tenantId}: ${error.message}`);
  }
}
