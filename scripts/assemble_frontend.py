import os

def main():
    base_dir = "/Users/manuelchavez/Documents/FinOpsProyect"
    print("Ensamblando Frontend SPA en", base_dir)
    
    # 1. ClientShell.tsx (Layout)
    shell_path = os.path.join(base_dir, "src", "components", "ClientShell.tsx")
    shell_code = """"use client";
import React, { useState } from 'react';

export default function ClientShell({ children }: { children: React.ReactNode }) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      {/* Sidebar */}
      <aside className={`${isSidebarOpen ? 'w-64' : 'w-20'} transition-all duration-300 bg-white border-r border-gray-200 flex flex-col`}>
        <div className="h-16 flex items-center justify-center border-b border-gray-200">
          <span className="font-bold text-[var(--color-primary)] text-xl truncate px-2">
            {isSidebarOpen ? 'CSCloud FinOps' : 'CS'}
          </span>
        </div>
        <nav className="flex-1 p-4 space-y-2">
          <a href="#" className="flex items-center gap-3 p-2 bg-blue-50 text-[var(--color-primary)] rounded-md font-medium">
            <span className="text-xl">📊</span>
            {isSidebarOpen && <span>Dashboard</span>}
          </a>
          <a href="#" className="flex items-center gap-3 p-2 hover:bg-gray-50 text-gray-700 rounded-md transition-colors">
            <span className="text-xl">⚡</span>
            {isSidebarOpen && <span>Quick Wins</span>}
          </a>
        </nav>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Navbar */}
        <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-6">
          <button 
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            className="text-gray-500 hover:text-[var(--color-primary)] transition-colors"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          
          <div className="flex items-center gap-4">
            <select className="border border-gray-300 rounded-md text-sm p-1.5 focus:outline-none focus:border-[var(--color-primary)] bg-white text-gray-700 cursor-pointer">
              <option>Tenant: Banco Ciudad</option>
              <option>Tenant: Asmepriv</option>
              <option>Tenant: Ctrl365</option>
            </select>
            <button className="bg-[var(--color-primary)] text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-blue-800 transition-colors shadow-sm">
              Iniciar sesión con Microsoft
            </button>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 overflow-y-auto p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
"""
    with open(shell_path, "w") as f:
        f.write(shell_code)

    # 2. Modificar layout.tsx
    layout_path = os.path.join(base_dir, "src", "app", "layout.tsx")
    layout_code = """import type { Metadata } from "next";
import { Montserrat, Open_Sans } from "next/font/google";
import "./globals.css";
import ClientShell from "@/components/ClientShell";

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
        <ClientShell>
          {children}
        </ClientShell>
      </body>
    </html>
  );
}
"""
    with open(layout_path, "w") as f:
        f.write(layout_code)

    # 3. ZombieResourcesTable.tsx
    table_path = os.path.join(base_dir, "src", "components", "ZombieResourcesTable.tsx")
    table_code = """"use client";
import React, { useEffect, useState } from 'react';

export default function ZombieResourcesTable() {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Simulando fetch de la API real
    fetch('/api/recommendations?subscriptionId=mock-sub')
      .then(res => res.json())
      .then(json => {
        if (json.error) {
          console.warn("Backend devolvió error:", json.error);
          // Fallback robusto sin lanzar excepcion para no detonar el Error Overlay de Next.js
          setData([
            { id: '1', resourceName: 'vm-prod-analytics-disk', type: 'Disk', issue: 'Disco sin asociar', potentialSavings: 15.5 },
            { id: '2', resourceName: 'ip-test-environment', type: 'Public IP', issue: 'IP Pública sin asignar', potentialSavings: 3.5 }
          ]);
          setError("Error de autenticación de Azure SDK. Mostrando datos de prueba locales.");
          setLoading(false);
          return;
        }
        setData(json.zombieResources || []);
        setLoading(false);
      })
      .catch(err => {
        console.error("Error de red:", err);
        setError("Fallo de red al consultar la API.");
        setLoading(false);
      });
  }, []);

  if (loading) return <div className="p-4 animate-pulse bg-gray-100 rounded-lg h-32 text-gray-500 font-medium">Escaneando recursos en Azure...</div>;

  return (
    <div className="bg-white shadow-sm rounded-lg overflow-hidden border border-gray-200">
      <div className="p-4 border-b border-gray-200 flex justify-between items-center bg-gray-50">
        <h2 className="text-lg font-semibold text-[var(--color-primary)]">Recursos Zombi Detectados</h2>
        {error && <span className="text-xs text-amber-600 bg-amber-50 px-2 py-1 rounded border border-amber-200">{error}</span>}
      </div>
      
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="text-gray-500 text-xs uppercase tracking-wider border-b border-gray-200 bg-white">
              <th className="p-4 font-medium">Recurso</th>
              <th className="p-4 font-medium">Tipo</th>
              <th className="p-4 font-medium">Problema</th>
              <th className="p-4 font-medium text-right">Ahorro Mensual (USD)</th>
            </tr>
          </thead>
          <tbody>
            {data.length > 0 ? data.map((item, i) => (
              <tr key={item.id || i} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                <td className="p-4 text-sm font-semibold text-gray-800">{item.resourceName}</td>
                <td className="p-4 text-sm text-gray-600">
                  <span className="bg-gray-100 text-gray-600 px-2 py-1 rounded text-xs">{item.type}</span>
                </td>
                <td className="p-4 text-sm text-gray-600">
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-50 text-red-700 border border-red-100">
                    {item.issue}
                  </span>
                </td>
                <td className="p-4 text-sm font-bold text-green-600 text-right">${item.potentialSavings.toFixed(2)}</td>
              </tr>
            )) : (
              <tr>
                <td colSpan={4} className="p-8 text-center text-sm text-gray-500">
                  No se detectaron recursos zombie. ¡Buen trabajo!
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
"""
    with open(table_path, "w") as f:
        f.write(table_code)

    # 4. Modificar page.tsx
    page_path = os.path.join(base_dir, "src", "app", "page.tsx")
    page_code = """import ZombieResourcesTable from "@/components/ZombieResourcesTable";

export default function Home() {
  return (
    <div className="flex flex-col gap-8 animate-in fade-in duration-500">
      <div className="flex justify-between items-end border-b border-gray-200 pb-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard General</h1>
          <p className="text-sm text-gray-500 mt-1">Visión global del rendimiento y eficiencia en la nube.</p>
        </div>
      </div>
      
      {/* Tabla de Recursos Zombie (Data Fetching Component) */}
      <section>
        <ZombieResourcesTable />
      </section>

      {/* Placeholders para reportes de Power BI (FinOps Toolkit) */}
      <section>
        <h2 className="text-xl font-bold text-gray-900 mb-4">Reportes de Costos (Power BI)</h2>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          <div className="bg-white border border-gray-200 rounded-lg shadow-sm h-72 flex items-center justify-center relative overflow-hidden group hover:shadow-md transition-shadow cursor-pointer">
            <div className="absolute inset-0 bg-blue-50/30 flex flex-col items-center justify-center gap-3">
              <span className="text-4xl opacity-40 group-hover:scale-110 transition-transform">📊</span>
              <h3 className="font-semibold text-gray-700 text-lg">Cost Summary</h3>
              <p className="text-xs text-gray-500 text-center px-6 leading-relaxed">
                Espacio reservado para embeber el reporte Power BI de <strong>Resumen de costos amortizados</strong>.
              </p>
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-lg shadow-sm h-72 flex items-center justify-center relative overflow-hidden group hover:shadow-md transition-shadow cursor-pointer">
            <div className="absolute inset-0 bg-blue-50/30 flex flex-col items-center justify-center gap-3">
              <span className="text-4xl opacity-40 group-hover:scale-110 transition-transform">📉</span>
              <h3 className="font-semibold text-gray-700 text-lg">Rate Optimization</h3>
              <p className="text-xs text-gray-500 text-center px-6 leading-relaxed">
                Espacio reservado para métricas de cobertura de <strong>Reservations</strong> y <strong>Savings Plans</strong>.
              </p>
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-lg shadow-sm h-72 flex items-center justify-center relative overflow-hidden group hover:shadow-md transition-shadow cursor-pointer">
            <div className="absolute inset-0 bg-blue-50/30 flex flex-col items-center justify-center gap-3">
              <span className="text-4xl opacity-40 group-hover:scale-110 transition-transform">⚡</span>
              <h3 className="font-semibold text-gray-700 text-lg">Workload Optimization</h3>
              <p className="text-xs text-gray-500 text-center px-6 leading-relaxed">
                Espacio reservado para reportes de <strong>Right-sizing</strong> y eficiencia computacional.
              </p>
            </div>
          </div>

        </div>
      </section>
    </div>
  );
}
"""
    with open(page_path, "w") as f:
        f.write(page_code)
        
    print("Frontend SPA ensamblado exitosamente.")

if __name__ == "__main__":
    main()
