import React from 'react';

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
