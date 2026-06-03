import os
import subprocess
import sys

def run_cmd(cmd, cwd=None):
    print(f"Ejecutando: {' '.join(cmd)}")
    subprocess.run(cmd, cwd=cwd, check=True)

def main():
    base_dir = "/Users/manuelchavez/Documents/FinOpsProyect"
    
    # 1. Instalar dependencias Azure
    print("\n--- 1. Instalando dependencias de Azure ---")
    run_cmd(["npm", "install", "@azure/identity", "@azure/arm-compute", "@azure/arm-network"], cwd=base_dir)
    
    # 2. Configurar layout.tsx con fuentes
    print("\n--- 2. Inyectando Fuentes Montserrat y Open Sans ---")
    layout_path = os.path.join(base_dir, "src", "app", "layout.tsx")
    layout_content = """import type { Metadata } from "next";
import { Montserrat, Open_Sans } from "next/font/google";
import "./globals.css";

const montserrat = Montserrat({
  variable: "--font-montserrat",
  subsets: ["latin"],
});

const openSans = Open_Sans({
  variable: "--font-open-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "FinOps Azure App - CSCloudSolutions",
  description: "Análisis, recomendaciones y remediación automatizada de costos en Azure",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body className={`${openSans.variable} ${montserrat.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}
"""
    with open(layout_path, "w") as f:
        f.write(layout_content)
        
    # 3. Configurar globals.css con colores y fuentes
    print("\n--- 3. Configurando variables CSS de Tailwind v4 ---")
    globals_path = os.path.join(base_dir, "src", "app", "globals.css")
    globals_content = """@import "tailwindcss";

:root {
  --background: #ffffff;
  --foreground: #171717;
}

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  /* Colores Corporativos CSCloudSolutions */
  --color-primary: #0054A6;
  --color-secondary: #00AEEF;
  --color-neutral-dark: #3C3C3C;
  --color-neutral-soft: #7F7F7F;
  /* Fuentes */
  --font-sans: var(--font-open-sans);
  --font-heading: var(--font-montserrat);
}

@media (prefers-color-scheme: dark) {
  :root {
    --background: #0a0a0a;
    --foreground: #ededed;
  }
}

body {
  background: var(--background);
  color: var(--foreground);
  font-family: var(--font-open-sans), sans-serif;
}

h1, h2, h3, h4, h5, h6 {
  font-family: var(--font-montserrat), sans-serif;
}
"""
    with open(globals_path, "w") as f:
        f.write(globals_content)
        
    # 4. Azure lib (src/lib/azure.ts)
    print("\n--- 4. Creando cliente de Autenticación de Azure ---")
    azure_ts_path = os.path.join(base_dir, "src", "lib", "azure.ts")
    azure_ts_content = """import { DefaultAzureCredential } from "@azure/identity";
import { ComputeManagementClient } from "@azure/arm-compute";
import { NetworkManagementClient } from "@azure/arm-network";

// La creacion de DefaultAzureCredential utilizará el entorno (variables, Managed Identity, Azure CLI)
export const credential = new DefaultAzureCredential();

export function getComputeClient(subscriptionId: string) {
  return new ComputeManagementClient(credential, subscriptionId);
}

export function getNetworkClient(subscriptionId: string) {
  return new NetworkManagementClient(credential, subscriptionId);
}
"""
    with open(azure_ts_path, "w") as f:
        f.write(azure_ts_content)
        
    # 5. Route recommendations (src/app/api/recommendations/route.ts)
    print("\n--- 5. Creando lógica de detección de Recursos Zombie ---")
    route_path = os.path.join(base_dir, "src", "app", "api", "recommendations", "route.ts")
    route_content = """import { NextRequest, NextResponse } from "next/server";
import { getComputeClient, getNetworkClient } from "@/lib/azure";

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const subscriptionId = searchParams.get('subscriptionId') || process.env.AZURE_SUBSCRIPTION_ID;

    if (!subscriptionId) {
      return NextResponse.json(
        { error: "El parámetro subscriptionId o la variable de entorno AZURE_SUBSCRIPTION_ID es requerida." },
        { status: 400 }
      );
    }

    const computeClient = getComputeClient(subscriptionId);
    const networkClient = getNetworkClient(subscriptionId);

    const zombieResources = [];

    // 1. Detectar Discos No Asociados (Unattached Disks)
    try {
      const disks = computeClient.disks.list();
      for await (const disk of disks) {
        if (disk.diskState === 'Unattached') {
          zombieResources.push({
            id: disk.id,
            resourceName: disk.name,
            type: "Disk",
            issue: "Disco sin asociar",
            potentialSavings: disk.diskSizeGB ? disk.diskSizeGB * 0.15 : 0 // Estimación de precio
          });
        }
      }
    } catch (computeError: any) {
      console.error("Error fetching disks:", computeError);
      throw new Error(`Fallo al consultar los recursos Compute: ${computeError.message}`);
    }

    // 2. Detectar IPs Públicas Estáticas No Asignadas
    try {
      const publicIPs = networkClient.publicIPAddresses.listAll();
      for await (const ip of publicIPs) {
        if (!ip.ipConfiguration) {
          zombieResources.push({
            id: ip.id,
            resourceName: ip.name,
            type: "Public IP",
            issue: "IP Pública sin asignar",
            potentialSavings: 3.5 // Estimación típica mensual
          });
        }
      }
    } catch (networkError: any) {
      console.error("Error fetching Public IPs:", networkError);
      throw new Error(`Fallo al consultar los recursos Network: ${networkError.message}`);
    }

    return NextResponse.json({
      success: true,
      subscriptionId,
      count: zombieResources.length,
      zombieResources,
    });

  } catch (error: any) {
    console.error("Recommendations API Error:", error);
    return NextResponse.json(
      { error: "Error interno del servidor durante la ejecución del SDK de Azure", details: error.message },
      { status: 500 }
    );
  }
}
"""
    with open(route_path, "w") as f:
        f.write(route_content)
        
    print("\nBackend y configuración de UI inyectados correctamente.")

if __name__ == "__main__":
    main()
