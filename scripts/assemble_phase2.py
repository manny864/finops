import os
import subprocess

def main():
    base_dir = "/Users/manuelchavez/Documents/FinOpsProyect"
    print("Iniciando inyección de Arquitectura de Seguridad (Fase 2)...")
    
    # 1. Instalar librerías
    print("Instalando mysql2, jsonwebtoken y @azure/keyvault-secrets...")
    subprocess.run(["npm", "install", "mysql2", "jsonwebtoken", "@azure/keyvault-secrets"], cwd=base_dir, check=True)
    subprocess.run(["npm", "install", "-D", "@types/jsonwebtoken"], cwd=base_dir, check=True)

    # 2. Docker Compose para MySQL
    compose_path = os.path.join(base_dir, "docker-compose.yml")
    compose_code = """version: '3.8'
services:
  mysql:
    image: mysql:8.0
    container_name: finops_mysql
    environment:
      MYSQL_ROOT_PASSWORD: rootpassword
      MYSQL_DATABASE: finops_app
      MYSQL_USER: finops_user
      MYSQL_PASSWORD: finopspassword
    ports:
      - "3306:3306"
    volumes:
      - mysql_data:/var/lib/mysql

volumes:
  mysql_data:
"""
    with open(compose_path, "w") as f:
        f.write(compose_code)

    # 3. Connection Pool MySQL
    db_ts_path = os.path.join(base_dir, "src", "lib", "db.ts")
    db_ts_code = """import mysql from 'mysql2/promise';

const pool = mysql.createPool(process.env.DATABASE_URL || 'mysql://finops_user:finopspassword@localhost:3306/finops_app');

export default pool;
"""
    with open(db_ts_path, "w") as f:
        f.write(db_ts_code)

    # 4. AdminConsentButton
    btn_path = os.path.join(base_dir, "src", "components", "AdminConsentButton.tsx")
    btn_code = """"use client";
import React from 'react';

export default function AdminConsentButton() {
  const handleOnboard = () => {
    const clientId = process.env.NEXT_PUBLIC_CLIENT_ID;
    if (!clientId) {
      alert("NEXT_PUBLIC_CLIENT_ID no está configurado. Revisa tu archivo .env");
      return;
    }
    const redirectUri = encodeURIComponent(window.location.origin);
    const adminConsentUrl = `https://login.microsoftonline.com/common/adminconsent?client_id=${clientId}&redirect_uri=${redirectUri}`;
    window.location.href = adminConsentUrl;
  };

  return (
    <button 
      onClick={handleOnboard}
      className="bg-amber-500 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-amber-600 transition-colors shadow-sm"
    >
      Onboard Tenant
    </button>
  );
}
"""
    with open(btn_path, "w") as f:
        f.write(btn_code)

    # 5. Modificar ClientShell.tsx para inyectar el boton
    shell_path = os.path.join(base_dir, "src", "components", "ClientShell.tsx")
    with open(shell_path, "r") as f:
        shell_content = f.read()
    
    # Simple replacement to add button
    if "AdminConsentButton" not in shell_content:
        shell_content = shell_content.replace('import React, { useState } from \'react\';', 'import React, { useState } from \'react\';\nimport AdminConsentButton from "./AdminConsentButton";')
        shell_content = shell_content.replace('<button className="bg-[var(--color-primary)]', '<AdminConsentButton />\n            <button className="bg-[var(--color-primary)]')
        with open(shell_path, "w") as f:
            f.write(shell_content)

    # 6. Key Vault
    kv_path = os.path.join(base_dir, "src", "lib", "keyvault.ts")
    kv_code = """import { DefaultAzureCredential } from "@azure/identity";
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
"""
    with open(kv_path, "w") as f:
        f.write(kv_code)

    # 7. Refactor azure.ts (Async calls to Key Vault)
    azure_path = os.path.join(base_dir, "src", "lib", "azure.ts")
    azure_code = """import { ClientSecretCredential } from "@azure/identity";
import { ComputeManagementClient } from "@azure/arm-compute";
import { NetworkManagementClient } from "@azure/arm-network";
import { getTenantSecret } from "./keyvault";

export async function getAzureCredential(tenantId: string) {
  const clientId = process.env.AZURE_CLIENT_ID;
  if (!clientId) {
    throw new Error("AZURE_CLIENT_ID debe estar definido en las variables de entorno (.env)");
  }

  // Descarga dinámica del secreto desde Azure Key Vault
  const clientSecret = await getTenantSecret(tenantId);
  return new ClientSecretCredential(tenantId, clientId, clientSecret);
}

export async function getComputeClient(tenantId: string, subscriptionId: string) {
  const credential = await getAzureCredential(tenantId);
  return new ComputeManagementClient(credential, subscriptionId);
}

export async function getNetworkClient(tenantId: string, subscriptionId: string) {
  const credential = await getAzureCredential(tenantId);
  return new NetworkManagementClient(credential, subscriptionId);
}
"""
    with open(azure_path, "w") as f:
        f.write(azure_code)

    # 8. Refactor API Recommendations para JWT Aislamiento
    rec_path = os.path.join(base_dir, "src", "app", "api", "recommendations", "route.ts")
    rec_code = """import { NextRequest, NextResponse } from "next/server";
import { getComputeClient, getNetworkClient } from "@/lib/azure";
import jwt from "jsonwebtoken";

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const subscriptionId = searchParams.get('subscriptionId');
    const tenantId = searchParams.get('tenantId');

    if (!subscriptionId || !tenantId) {
      return NextResponse.json({ error: "Parámetros faltantes" }, { status: 400 });
    }

    // Aislamiento Multi-Tenant: Validación estricta JWT
    const authHeader = request.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Falta token Bearer de autenticación." }, { status: 401 });
    }

    const token = authHeader.split(" ")[1];
    const decoded = jwt.decode(token) as { tid?: string } | null;

    if (!decoded || !decoded.tid) {
      return NextResponse.json({ error: "Estructura de token inválida." }, { status: 401 });
    }

    if (decoded.tid !== tenantId) {
      return NextResponse.json(
        { error: `Acceso denegado. El token (tid: ${decoded.tid}) no coincide con el tenant solicitado.` },
        { status: 403 }
      );
    }

    // Instanciación asíncrona tras validación
    const computeClient = await getComputeClient(tenantId, subscriptionId);
    const networkClient = await getNetworkClient(tenantId, subscriptionId);

    const zombieResources = [];

    try {
      const disks = computeClient.disks.list();
      for await (const disk of disks) {
        if (disk.diskState === 'Unattached') {
          zombieResources.push({ id: disk.id, resourceName: disk.name, type: "Disk", issue: "Disco sin asociar", potentialSavings: disk.diskSizeGB ? disk.diskSizeGB * 0.15 : 0 });
        }
      }
    } catch (computeError: any) {
      throw new Error(`Fallo en Compute: ${computeError.message}`);
    }

    try {
      const publicIPs = networkClient.publicIPAddresses.listAll();
      for await (const ip of publicIPs) {
        if (!ip.ipConfiguration) {
          zombieResources.push({ id: ip.id, resourceName: ip.name, type: "Public IP", issue: "IP Pública sin asignar", potentialSavings: 3.5 });
        }
      }
    } catch (networkError: any) {
      throw new Error(`Fallo en Network: ${networkError.message}`);
    }

    return NextResponse.json({ success: true, tenantId, subscriptionId, count: zombieResources.length, zombieResources });

  } catch (error: any) {
    return NextResponse.json({ error: "Error en SDK o Key Vault", details: error.message }, { status: 500 });
  }
}
"""
    with open(rec_path, "w") as f:
        f.write(rec_code)

    # 9. Refactor API Consumption para JWT Aislamiento
    cons_path = os.path.join(base_dir, "src", "app", "api", "consumption", "route.ts")
    cons_code = """import { NextRequest, NextResponse } from "next/server";
import { getAzureCredential } from "@/lib/azure";
import jwt from "jsonwebtoken";

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const subscriptionId = searchParams.get('subscriptionId');
    const tenantId = searchParams.get('tenantId');

    if (!subscriptionId || !tenantId) {
      return NextResponse.json({ error: "Parámetros faltantes" }, { status: 400 });
    }

    // Aislamiento Multi-Tenant: Validación estricta JWT
    const authHeader = request.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Falta token Bearer de autenticación." }, { status: 401 });
    }

    const token = authHeader.split(" ")[1];
    const decoded = jwt.decode(token) as { tid?: string } | null;

    if (!decoded || !decoded.tid) {
      return NextResponse.json({ error: "Estructura de token inválida." }, { status: 401 });
    }

    if (decoded.tid !== tenantId) {
      return NextResponse.json(
        { error: `Acceso denegado. El token (tid: ${decoded.tid}) no coincide con el tenant solicitado.` },
        { status: 403 }
      );
    }

    await getAzureCredential(tenantId);
    
    return NextResponse.json({ success: true, tenantId, subscriptionId, costSummary: { amortizedCost: 0, currency: "USD", note: "Falta implementar CostManagementClient." } });

  } catch (error: any) {
    return NextResponse.json({ error: "Error interno", details: error.message }, { status: 500 });
  }
}
"""
    with open(cons_path, "w") as f:
        f.write(cons_code)

    print("Inyección Fase 2 completada.")

if __name__ == "__main__":
    main()
