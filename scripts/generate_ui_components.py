import os

def main():
    base_dir = "/Users/manuelchavez/Documents/FinOpsProyect"
    print("Generando componentes de UI en", base_dir)
    
    # Directorios
    layout_dir = os.path.join(base_dir, "src", "components", "layout")
    dashboard_dir = os.path.join(base_dir, "src", "components", "dashboard")
    remediation_dir = os.path.join(base_dir, "src", "components", "remediation")
    
    os.makedirs(layout_dir, exist_ok=True)
    os.makedirs(dashboard_dir, exist_ok=True)
    os.makedirs(remediation_dir, exist_ok=True)
    
    # 1. FinOpsDashboardLayout.tsx
    layout_code = """import React from 'react';

export default function FinOpsDashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50 grid gap-4 p-4" style={{
      gridTemplateColumns: '250px 1fr',
      gridTemplateAreas: `
        "header header"
        "sidebar main"
        "footer footer"
      `,
      gridTemplateRows: 'auto 1fr auto'
    }}>
      <header style={{ gridArea: 'header' }} className="bg-white p-4 shadow-sm rounded-lg flex items-center justify-between">
        <h1 className="text-xl font-bold text-blue-900">CSCloudSolutions FinOps</h1>
        <div className="flex gap-4">
          <span className="text-sm text-gray-500 font-mono">Tenant ID: 000-000</span>
        </div>
      </header>
      
      <aside style={{ gridArea: 'sidebar' }} className="bg-white p-4 shadow-sm rounded-lg">
        <nav className="flex flex-col gap-2">
          <a href="#" className="p-2 bg-blue-50 text-blue-700 rounded-md font-medium">Dashboard</a>
          <a href="#" className="p-2 hover:bg-gray-50 text-gray-700 rounded-md transition-colors">Quick Wins</a>
          <a href="#" className="p-2 hover:bg-gray-50 text-gray-700 rounded-md transition-colors">Aprobaciones</a>
        </nav>
      </aside>
      
      <main style={{ gridArea: 'main' }} className="flex flex-col gap-4">
        {children}
      </main>
      
      <footer style={{ gridArea: 'footer' }} className="bg-white p-4 shadow-sm rounded-lg text-center text-xs text-gray-400">
        FinOps Certified Service Provider - CSCloudSolutions
      </footer>
    </div>
  );
}
"""
    with open(os.path.join(layout_dir, "FinOpsDashboardLayout.tsx"), "w") as f:
        f.write(layout_code)

    # 2. ExecutiveSummaryCard.tsx
    exec_card_code = """import React from 'react';

export default function ExecutiveSummaryCard({ title, amount, trend }: { title: string, amount: string, trend: string }) {
  return (
    <div className="bg-white shadow-sm rounded-lg p-6 border-l-4 border-blue-500" style={{ containerType: 'inline-size', containerName: 'card' }}>
      <div className="flex flex-col gap-2">
        <h3 className="text-gray-500 font-medium tracking-wide uppercase text-xs">{title}</h3>
        {/* Fluid typography using Container Query Units (cqi) */}
        <p className="font-bold text-gray-900" style={{ fontSize: 'clamp(1.5rem, 8cqi, 2.5rem)' }}>
          {amount}
        </p>
        <div className="text-sm font-medium text-green-600 bg-green-50 w-max px-2 py-1 rounded-md">
          {trend}
        </div>
      </div>
    </div>
  );
}
"""
    with open(os.path.join(dashboard_dir, "ExecutiveSummaryCard.tsx"), "w") as f:
        f.write(exec_card_code)

    # 3. QuickWinsTable.tsx
    table_code = """import React from 'react';

// Expected Data Interface
export interface QuickWin {
  id: string;
  resourceName: string;
  type: string;
  issue: string;
  potentialSavings: number;
}

export default function QuickWinsTable({ wins }: { wins: QuickWin[] }) {
  return (
    <div className="bg-white shadow-sm rounded-lg overflow-hidden border border-gray-200">
      <div className="p-4 border-b border-gray-200">
        <h2 className="text-lg font-semibold text-gray-800">Top Quick Wins Detectables</h2>
      </div>
      
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-gray-50 text-gray-600 text-sm border-b border-gray-200">
              <th className="p-4 font-medium">Recurso</th>
              <th className="p-4 font-medium">Tipo</th>
              <th className="p-4 font-medium">Hallazgo</th>
              <th className="p-4 font-medium text-right">Ahorro Estimado</th>
            </tr>
          </thead>
          <tbody>
            {wins?.length ? wins.map((win) => (
              <tr 
                key={win.id} 
                className="border-b border-gray-100 hover:bg-gray-50 transition-colors"
                // Performance Optimization for Heavy Tables using content-visibility
                style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 50px' }}
              >
                <td className="p-4 text-sm font-medium text-blue-600">{win.resourceName}</td>
                <td className="p-4 text-sm text-gray-600">{win.type}</td>
                <td className="p-4 text-sm text-gray-600">
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                    {win.issue}
                  </span>
                </td>
                <td className="p-4 text-sm font-bold text-gray-900 text-right">${win.potentialSavings}/mo</td>
              </tr>
            )) : (
              <tr>
                <td colSpan={4} className="p-4 text-center text-sm text-gray-500">No hay Quick Wins detectados.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
"""
    with open(os.path.join(dashboard_dir, "QuickWinsTable.tsx"), "w") as f:
        f.write(table_code)

    # 4. ApprovalWorkflowBoard.tsx
    board_code = """import React from 'react';

export default function ApprovalWorkflowBoard() {
  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold text-gray-800">Cola de Remediación (Just-In-Time)</h2>
      
      {/* Kanban-style flex layout */}
      <div className="flex flex-col md:flex-row gap-4 items-start">
        
        {/* Pendiente de Aprobacion */}
        <div className="flex-1 bg-gray-50 rounded-lg p-4 border border-gray-200 w-full">
          <h3 className="text-sm font-bold text-gray-500 uppercase mb-4 flex items-center justify-between">
            Pendiente <span className="bg-gray-200 text-gray-700 px-2 py-0.5 rounded-full text-xs">2</span>
          </h3>
          <div className="flex flex-col gap-3">
            <div className="bg-white p-4 rounded-md shadow-sm border-l-4 border-yellow-400 flex flex-col gap-3">
              <div>
                <h4 className="font-semibold text-sm text-gray-900">VM idle {`>`} 14 días</h4>
                <p className="text-xs text-gray-500 font-mono">vm-prod-analytics</p>
              </div>
              <div className="flex justify-between items-center mt-2 pt-2 border-t border-gray-100">
                <span className="text-sm font-bold text-green-600">Ahorro: $150</span>
                <button className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium px-3 py-1.5 rounded transition-colors">
                  Aprobar
                </button>
              </div>
            </div>
            <div className="bg-white p-4 rounded-md shadow-sm border-l-4 border-yellow-400 flex flex-col gap-3">
              <div>
                <h4 className="font-semibold text-sm text-gray-900">Disco no asociado</h4>
                <p className="text-xs text-gray-500 font-mono">disk-backup-old</p>
              </div>
              <div className="flex justify-between items-center mt-2 pt-2 border-t border-gray-100">
                <span className="text-sm font-bold text-green-600">Ahorro: $40</span>
                <button className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium px-3 py-1.5 rounded transition-colors">
                  Aprobar
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* En Ejecucion */}
        <div className="flex-1 bg-gray-50 rounded-lg p-4 border border-gray-200 w-full opacity-70">
          <h3 className="text-sm font-bold text-gray-500 uppercase mb-4 flex items-center justify-between">
            En Ejecución <span className="bg-gray-200 text-gray-700 px-2 py-0.5 rounded-full text-xs">0</span>
          </h3>
          <div className="p-8 text-center text-sm text-gray-400 border-2 border-dashed border-gray-200 rounded-md">
            No hay tareas ejecutándose (Logic Apps)
          </div>
        </div>
        
      </div>
    </div>
  );
}
"""
    with open(os.path.join(remediation_dir, "ApprovalWorkflowBoard.tsx"), "w") as f:
        f.write(board_code)
        
    print("Todos los componentes generados exitosamente en src/components.")

if __name__ == "__main__":
    main()
