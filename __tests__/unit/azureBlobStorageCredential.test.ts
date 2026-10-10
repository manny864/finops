import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Qué credencial usa el cliente de Blob. La regresión que cuida: con
 * AZURE_STORAGE_ACCOUNT_NAME puesto, DefaultAzureCredential toma el app
 * registration de CSCS (AZURE_CLIENT_ID/AZURE_CLIENT_SECRET) antes que la
 * identidad administrada y el storage contesta 403; en prod hay que ir directo a
 * ManagedIdentityCredential con AZURE_KEYVAULT_MI_CLIENT_ID.
 */
const m = vi.hoisted(() => {
  const blockBlob = { uploadData: vi.fn(async () => undefined) };
  const container = {
    createIfNotExists: vi.fn(async () => undefined),
    getBlockBlobClient: vi.fn(() => blockBlob),
  };
  const service = { getContainerClient: vi.fn(() => container) };
  const BlobServiceClient = Object.assign(
    vi.fn(function () {
      return service;
    }),
    { fromConnectionString: vi.fn(() => service) },
  );
  const ManagedIdentityCredential = vi.fn(function (this: Record<string, unknown>, options: unknown) {
    this.kind = "managed-identity";
    this.options = options;
  });
  const DefaultAzureCredential = vi.fn(function (this: Record<string, unknown>) {
    this.kind = "default";
  });
  return { BlobServiceClient, ManagedIdentityCredential, DefaultAzureCredential };
});

vi.mock("@azure/storage-blob", () => ({ BlobServiceClient: m.BlobServiceClient }));
vi.mock("@azure/identity", () => ({
  ManagedIdentityCredential: m.ManagedIdentityCredential,
  DefaultAzureCredential: m.DefaultAzureCredential,
}));

import { _resetForTests, isBlobStorageEnabled, uploadBlob } from "@/lib/azureBlobStorage";

const ENV = ["AZURE_STORAGE_ACCOUNT_NAME", "AZURE_STORAGE_CONNECTION_STRING", "AZURE_KEYVAULT_MI_CLIENT_ID"] as const;

async function conectar() {
  await uploadBlob("contenedor", "archivo.txt", Buffer.from("x"), "text/plain");
}

describe("credencial del cliente de Blob", () => {
  beforeEach(() => {
    for (const k of ENV) vi.stubEnv(k, "");
    vi.clearAllMocks();
    _resetForTests();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("en Container Apps usa la identidad administrada con su client id, nunca la cadena por defecto", async () => {
    vi.stubEnv("AZURE_STORAGE_ACCOUNT_NAME", "cuentaprod");
    vi.stubEnv("AZURE_KEYVAULT_MI_CLIENT_ID", "00000000-0000-0000-0000-00000000mi01");

    await conectar();

    expect(m.ManagedIdentityCredential).toHaveBeenCalledWith({ clientId: "00000000-0000-0000-0000-00000000mi01" });
    expect(m.DefaultAzureCredential).not.toHaveBeenCalled();
    const [url, credential] = m.BlobServiceClient.mock.calls[0] as unknown as [string, { kind: string }];
    expect(url).toBe("https://cuentaprod.blob.core.windows.net");
    expect(credential.kind).toBe("managed-identity");
    expect(m.BlobServiceClient.fromConnectionString).not.toHaveBeenCalled();
  });

  it("sin identidad administrada (desarrollo local) cae a la cadena por defecto", async () => {
    vi.stubEnv("AZURE_STORAGE_ACCOUNT_NAME", "cuentadev");

    await conectar();

    expect(m.DefaultAzureCredential).toHaveBeenCalledTimes(1);
    expect(m.ManagedIdentityCredential).not.toHaveBeenCalled();
  });

  it("si están las dos configuraciones gana la cuenta: la connection string se ignora", async () => {
    vi.stubEnv("AZURE_STORAGE_ACCOUNT_NAME", "cuentaprod");
    vi.stubEnv("AZURE_STORAGE_CONNECTION_STRING", "DefaultEndpointsProtocol=https;AccountName=x;AccountKey=y");
    vi.stubEnv("AZURE_KEYVAULT_MI_CLIENT_ID", "00000000-0000-0000-0000-00000000mi01");

    await conectar();

    expect(m.BlobServiceClient.fromConnectionString).not.toHaveBeenCalled();
    expect(m.ManagedIdentityCredential).toHaveBeenCalledTimes(1);
  });

  it("sin cuenta, con connection string: sigue funcionando como hoy en producción", async () => {
    vi.stubEnv("AZURE_STORAGE_CONNECTION_STRING", "DefaultEndpointsProtocol=https;AccountName=x;AccountKey=y");
    vi.stubEnv("AZURE_KEYVAULT_MI_CLIENT_ID", "00000000-0000-0000-0000-00000000mi01");

    await conectar();

    expect(m.BlobServiceClient.fromConnectionString).toHaveBeenCalledTimes(1);
    expect(m.ManagedIdentityCredential).not.toHaveBeenCalled();
    expect(m.DefaultAzureCredential).not.toHaveBeenCalled();
  });

  it("isBlobStorageEnabled distingue entre configurado y no", () => {
    expect(isBlobStorageEnabled()).toBe(false);
    vi.stubEnv("AZURE_STORAGE_ACCOUNT_NAME", "cuentaprod");
    expect(isBlobStorageEnabled()).toBe(true);
  });
});
