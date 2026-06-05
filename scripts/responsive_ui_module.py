import os
import re

base_dir = "/Users/manuelchavez/Documents/FinOpsProyect"

def deploy():
    print("1. Creando directiva SOP...")
    os.makedirs(os.path.join(base_dir, "directivas"), exist_ok=True)
    sop_path = os.path.join(base_dir, "directivas/responsive_ui_SOP.md")
    with open(sop_path, "w") as f:
        f.write("# Responsive UI & Dashboard Restructure SOP\\n\\n")
        f.write("## Objetivo\\nAsegurar que la plataforma FinOps sea responsiva en PC, tabletas y móviles. Reordenar las cajas del dashboard para evitar espacios vacíos.\\n\\n")
        f.write("## Implementación\\n- `Sidebar`: Off-canvas absoluto en móviles, con overlay.\\n- `ClientShell`: Headers responsivos.\\n- `Dashboard`: Layout de Grid actualizado con `col-span-full` para gráficos anchos.\\n")

    print("2. Actualizando ClientShell.tsx...")
    shell_path = os.path.join(base_dir, "src/components/ClientShell.tsx")
    with open(shell_path, "r") as f:
        shell_content = f.read()

    # Make Sidebar responsive in ClientShell
    if "Mobile Overlay" not in shell_content:
        # We need to pass setSidebarOpen to Sidebar, but instead let's just wrap it.
        # Wait, Sidebar is imported and used as <Sidebar sidebarOpen={sidebarOpen} />
        # We'll replace the Sidebar render
        sidebar_render = "<Sidebar sidebarOpen={sidebarOpen} />"
        new_sidebar_render = """{/* Mobile Overlay */}
      {sidebarOpen && (
        <div 
          className="fixed inset-0 bg-gray-900/50 z-40 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <div className={`fixed inset-y-0 left-0 z-50 transform md:relative md:translate-x-0 transition-transform duration-300 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <Sidebar sidebarOpen={sidebarOpen} />
      </div>"""
        shell_content = shell_content.replace(sidebar_render, new_sidebar_render)

        # Fix header responsiveness
        # <h1 className="text-xl font-bold text-gray-800 dark:text-white hidden sm:block tracking-tight">Cloud FinOps</h1>
        # That is already responsive (hidden sm:block).
        # Fix tenant select dropping to next line or hiding on mobile
        # <div className="hidden md:flex items-center ..."> this is already hiding on mobile!
        
        with open(shell_path, "w") as f:
            f.write(shell_content)

    print("3. Actualizando Sidebar.tsx...")
    sidebar_path = os.path.join(base_dir, "src/components/Sidebar.tsx")
    with open(sidebar_path, "r") as f:
        sidebar_content = f.read()
    
    # Change <aside className={`... ${sidebarOpen ? 'w-64' : 'w-20'}`}> to ensure it takes full height and behaves correctly
    aside_pattern = r"<aside className={`bg-white dark:bg-slate-900 border-r border-gray-200 dark:border-slate-800 flex flex-col transition-all duration-300 \${sidebarOpen \? 'w-64' : 'w-20'}`}\>"
    new_aside = "<aside className={`bg-white dark:bg-slate-900 border-r border-gray-200 dark:border-slate-800 flex flex-col transition-all duration-300 h-screen ${sidebarOpen ? 'w-64' : 'w-20 hidden md:flex'}`}>"
    sidebar_content = re.sub(aside_pattern, new_aside, sidebar_content)
    
    with open(sidebar_path, "w") as f:
        f.write(sidebar_content)

    print("4. Actualizando BudgetBurnChart.tsx (quitando mt-6 para que el grid lo maneje)...")
    budget_path = os.path.join(base_dir, "src/components/dashboard/BudgetBurnChart.tsx")
    with open(budget_path, "r") as f:
        budget_content = f.read()
    budget_content = budget_content.replace('className="bg-white border border-gray-200 rounded-lg shadow-sm p-6 mt-6"', 'className="bg-white border border-gray-200 rounded-lg shadow-sm p-6 h-full"')
    with open(budget_path, "w") as f:
        f.write(budget_content)

    print("5. Reestructurando Dashboard Grid en page.tsx...")
    page_path = os.path.join(base_dir, "src/app/[locale]/page.tsx")
    with open(page_path, "r") as f:
        page_content = f.read()

    # The existing layout is:
    # <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
    #   <div className="flex flex-col"> ... CostPieChart ... </div>
    #   <div className="flex flex-col"> ... Governance ... <BudgetBurnChart /> </div>
    # </div>
    
    # We want:
    # <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
    #   <div className="col-span-1 flex flex-col"> ... Governance ... </div>
    #   <div className="col-span-1 md:col-span-1 lg:col-span-2 flex flex-col"> ... CostPieChart ... </div>
    #   <div className="col-span-1 md:col-span-2 lg:col-span-3 flex flex-col"> <BudgetBurnChart /> </div>
    # </div>

    # Find the dashboard layout wrapper
    old_grid_start = '<div className="grid grid-cols-1 lg:grid-cols-2 gap-6">'
    
    # Find the pie chart block
    pie_start_idx = page_content.find('<div className="flex flex-col">\\n            <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-6 flex flex-col">\\n                 <h3 className="text-lg font-bold text-gray-800 mb-1">Distribución de Fugas Financieras</h3>')
    
    # Find the governance block
    gov_start_idx = page_content.find('<div className="flex flex-col">\\n            <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-6">\\n             <h3 className="text-lg font-bold text-gray-800 mb-4">Estado de Gobernanza</h3>')

    if old_grid_start in page_content and pie_start_idx != -1 and gov_start_idx != -1:
        # Extract blocks
        # Pie block goes until the next <div className="flex flex-col"> or end of grid
        pie_block_end = page_content.find('</div>\\n            \\n            \\n        </div>', pie_start_idx) + len('</div>\\n            \\n            \\n        </div>')
        pie_block = page_content[pie_start_idx:pie_block_end]
        pie_block_new = pie_block.replace('<div className="flex flex-col">', '<div className="col-span-1 lg:col-span-2 flex flex-col">')

        # Gov block
        gov_block_end = page_content.find('</div>\\n        \\n        <BudgetBurnChart />\\n        </div>', gov_start_idx)
        # Actually gov block ends right before <BudgetBurnChart />
        gov_block_end_real = page_content.find('<BudgetBurnChart />', gov_start_idx)
        # Let's cleanly replace
        
        # Build the new grid manually using regex/replace
        new_grid = f"""<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        
        {'{/* Governance Box */}'}
        <div className="col-span-1 flex flex-col">
            <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-6 h-full">
             <h3 className="text-lg font-bold text-gray-800 mb-4">Estado de Gobernanza</h3>
             <div className="h-64 flex flex-col items-center justify-center text-gray-400 bg-gray-50 rounded-lg border border-dashed border-gray-300">
                 <p className="text-sm font-medium">Score de Seguridad Financiera</p>
                 <span className={{`text-4xl font-bold mt-2 ${{complianceScore === -1 ? 'text-gray-400' : 'text-green-500'}}`}}>
                     {{complianceScore === null ? 'Calculando...' : complianceScore === -1 ? 'No Configurado' : `${{complianceScore}}%`}}
                 </span>
                 <p className="text-xs text-gray-400 mt-2 text-center px-8">
                     {{complianceScore === -1 ? 'Añade reglas en Gestión de Etiquetas.' : 'Basado en las reglas de etiquetado activas.'}}
                 </p>
                 {{complianceScore === -1 && (
                     <button 
                         onClick={{() => setActiveTab('tags')}} 
                         className="mt-4 px-4 py-2 bg-[#0054A6] text-white text-xs font-semibold rounded shadow-sm hover:bg-blue-800 transition-colors"
                     >
                         Configurar Políticas
                     </button>
                 )}}
             </div>
            </div>
        </div>

        {'{/* Fugas Financieras Box */}'}
        <div className="col-span-1 md:col-span-1 lg:col-span-2 flex flex-col">
            <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-6 flex flex-col h-full">
                 <h3 className="text-lg font-bold text-gray-800 mb-1">Distribución de Fugas Financieras</h3>
                 <p className="text-xs text-gray-500 mb-4">Haz clic en un segmento para ver los recursos afectados.</p>
                 {{loading ? (
                     <div className="flex-1 flex items-center justify-center text-gray-400 animate-pulse">Calculando métricas...</div>
                 ) : (
                     <CostPieChart data={{dashboardData}} onSegmentClick={{(cat) => setSelectedCategory(cat)}} />
                 )}}
            </div>
        </div>

        {'{/* Budget Burn Box */}'}
        <div className="col-span-1 md:col-span-2 lg:col-span-3">
            <BudgetBurnChart />
        </div>

      </div>"""

        # We replace the entire old grid
        # find the end of the old grid
        old_grid_end = page_content.find('</div>\\n\\n      {selectedCategory && (', page_content.find(old_grid_start))
        
        page_content = page_content[:page_content.find(old_grid_start)] + new_grid + "\\n" + page_content[old_grid_end:]
        
        with open(page_path, "w") as f:
            f.write(page_content)
    
    print("Dashboard Responsive refactor complete.")

if __name__ == "__main__":
    deploy()
