import os

base_dir = "/Users/manuelchavez/Documents/FinOpsProyect"

def deploy():
    # 1. Create Context
    print("Creando ViewModeContext.tsx...")
    context_dir = os.path.join(base_dir, "src/context")
    os.makedirs(context_dir, exist_ok=True)
    with open(os.path.join(context_dir, "ViewModeContext.tsx"), "w") as f:
        f.write(""""use client";
import React, { createContext, useContext, useState } from 'react';

type ViewMode = 'executive' | 'engineer';

interface ViewModeContextType {
    viewMode: ViewMode;
    toggleViewMode: () => void;
}

const ViewModeContext = createContext<ViewModeContextType>({
    viewMode: 'executive',
    toggleViewMode: () => {},
});

export function ViewModeProvider({ children }: { children: React.ReactNode }) {
    const [viewMode, setViewMode] = useState<ViewMode>('executive');

    const toggleViewMode = () => {
        setViewMode(prev => prev === 'executive' ? 'engineer' : 'executive');
    };

    return (
        <ViewModeContext.Provider value={{ viewMode, toggleViewMode }}>
            {children}
        </ViewModeContext.Provider>
    );
}

export function useViewMode() {
    return useContext(ViewModeContext);
}
""")

    # 2. Update ClientShell.tsx
    print("Actualizando ClientShell.tsx...")
    shell_path = os.path.join(base_dir, "src/components/ClientShell.tsx")
    with open(shell_path, "r") as f:
        shell_content = f.read()
        
    if "ViewModeProvider" not in shell_content:
        shell_content = shell_content.replace(
            "import { TenantProvider, useTenant } from './TenantProvider';",
            "import { TenantProvider, useTenant } from './TenantProvider';\nimport { ViewModeProvider, useViewMode } from '../context/ViewModeContext';\nimport { LayoutTemplate, Code2 } from 'lucide-react';"
        )
        
        shell_content = shell_content.replace(
            "<TenantProvider>",
            "<TenantProvider>\n        <ViewModeProvider>"
        )
        shell_content = shell_content.replace(
            "</TenantProvider>",
            "</ViewModeProvider>\n      </TenantProvider>"
        )
        
        shell_content = shell_content.replace(
            "const isAuthenticated = useIsAuthenticated();",
            "const isAuthenticated = useIsAuthenticated();\n  const { viewMode, toggleViewMode } = useViewMode();"
        )
        
        toggle_ui = """
            {/* View Toggle */}
            <div className="hidden sm:flex items-center bg-gray-100 rounded-lg p-1 mr-4 border border-gray-200">
                <button
                    onClick={() => viewMode !== 'executive' && toggleViewMode()}
                    className={`flex items-center px-3 py-1.5 text-xs font-bold rounded-md transition-colors ${viewMode === 'executive' ? 'bg-white shadow-sm text-indigo-700' : 'text-gray-500 hover:text-gray-700'}`}
                >
                    <LayoutTemplate className="w-4 h-4 mr-1.5" />
                    Ejecutivo
                </button>
                <button
                    onClick={() => viewMode !== 'engineer' && toggleViewMode()}
                    className={`flex items-center px-3 py-1.5 text-xs font-bold rounded-md transition-colors ${viewMode === 'engineer' ? 'bg-gray-800 shadow-sm text-green-400' : 'text-gray-500 hover:text-gray-700'}`}
                >
                    <Code2 className="w-4 h-4 mr-1.5" />
                    Ingeniero
                </button>
            </div>
            """
        shell_content = shell_content.replace(
            "<AuthButton />",
            toggle_ui + "\n            <AuthButton />"
        )
        
        with open(shell_path, "w") as f:
            f.write(shell_content)

    # 3. Update ZombieResourcesTable.tsx
    print("Actualizando ZombieResourcesTable.tsx...")
    zombies_path = os.path.join(base_dir, "src/components/ZombieResourcesTable.tsx")
    with open(zombies_path, "r") as f:
        zombies_content = f.read()

    if "useViewMode" not in zombies_content:
        zombies_content = zombies_content.replace(
            "import { useTenant } from './TenantProvider';",
            "import { useTenant } from './TenantProvider';\nimport { useViewMode } from '../context/ViewModeContext';"
        )
        zombies_content = zombies_content.replace(
            "const { selectedTenant } = useTenant();",
            "const { selectedTenant } = useTenant();\n  const { viewMode } = useViewMode();"
        )

        headers_old = """<th className="p-4 font-medium">Suscripción</th>
                <th className="p-4 font-medium">Tipo</th>
                <th className="p-4 font-medium">Problema</th>"""
        headers_new = """{viewMode === 'engineer' && <th className="p-4 font-medium text-gray-400">Resource ID / ARM Type</th>}
                {viewMode === 'engineer' && <th className="p-4 font-medium">Suscripción</th>}
                <th className="p-4 font-medium">Tipo</th>
                <th className="p-4 font-medium">Problema</th>"""
        zombies_content = zombies_content.replace(headers_old, headers_new)

        rows_old = """<td className="p-4 text-xs font-mono text-gray-500">{item.subscriptionId === 'all' ? 'N/A' : item.subscriptionId.substring(0,8) + '...'}</td>
                  <td className="p-4 text-sm text-gray-600">
                    <span className="bg-gray-100 text-gray-600 px-2 py-1 rounded text-xs">{item.type}</span>
                  </td>
                  <td className="p-4 text-sm text-gray-600">"""
        rows_new = """{viewMode === 'engineer' && (
                    <td className="p-4 text-xs font-mono text-gray-400 max-w-[150px] truncate" title={item.id}>
                      <div className="text-gray-300 font-semibold">{item.id?.split('/').pop()}</div>
                      <div className="text-[10px] text-gray-500 mt-1">{item.armType}</div>
                    </td>
                  )}
                  {viewMode === 'engineer' && <td className="p-4 text-xs font-mono text-gray-500">{item.subscriptionId === 'all' ? 'N/A' : item.subscriptionId.substring(0,8) + '...'}</td>}
                  <td className="p-4 text-sm text-gray-600">
                    <span className="bg-gray-100 text-gray-600 px-2 py-1 rounded text-xs">{item.type}</span>
                  </td>
                  <td className="p-4 text-sm text-gray-600">"""
        zombies_content = zombies_content.replace(rows_old, rows_new)
        
        zombies_content = zombies_content.replace(
            """<td colSpan={6} className="p-8 text-center text-sm text-gray-500">""",
            """<td colSpan={viewMode === 'engineer' ? 8 : 6} className="p-8 text-center text-sm text-gray-500">"""
        )

        with open(zombies_path, "w") as f:
            f.write(zombies_content)

    # 4. Update Rightsizing Table
    print("Actualizando Rightsizing page.tsx...")
    right_path = os.path.join(base_dir, "src/app/intelligence/rightsizing/page.tsx")
    with open(right_path, "r") as f:
        right_content = f.read()

    if "useViewMode" not in right_content:
        right_content = right_content.replace(
            """import { useTenant } from "@/components/TenantProvider";""",
            """import { useTenant } from "@/components/TenantProvider";\nimport { useViewMode } from "@/context/ViewModeContext";"""
        )
        right_content = right_content.replace(
            "const { selectedTenant } = useTenant();",
            "const { selectedTenant } = useTenant();\n  const { viewMode } = useViewMode();"
        )
        
        r_headers_old = """<th className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Nombre de VM</th>"""
        r_headers_new = """<th className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Nombre de VM</th>
                            {viewMode === 'engineer' && <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Raw ARM ID</th>}"""
        right_content = right_content.replace(r_headers_old, r_headers_new)
        
        r_rows_old = """<td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-gray-900 flex items-center">
                                    <AlertTriangle className="w-4 h-4 text-amber-500 mr-2" />
                                    {vm.name}
                                </td>"""
        r_rows_new = """<td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-gray-900 flex items-center">
                                    <AlertTriangle className="w-4 h-4 text-amber-500 mr-2" />
                                    {vm.name}
                                </td>
                                {viewMode === 'engineer' && (
                                    <td className="px-6 py-4 whitespace-nowrap text-xs font-mono text-gray-400 max-w-xs truncate" title={vm.id}>
                                        {vm.id}
                                    </td>
                                )}"""
        right_content = right_content.replace(r_rows_old, r_rows_new)
        
        with open(right_path, "w") as f:
            f.write(right_content)
            
    print("Generando SOP...")
    sop_path = os.path.join(base_dir, "directivas/view_mode_SOP.md")
    os.makedirs(os.path.dirname(sop_path), exist_ok=True)
    with open(sop_path, "w") as f:
        f.write("# View Mode SOP\\n\\n")
        f.write("- **Context API**: El estado `viewMode` se almacena globalmente en `ViewModeContext.tsx` y es consumido por los componentes descendientes.\\n")
        f.write("- **Segregación de UI**: Las columnas técnicas (Suscripción, Resource ID, ARM Type) se renderizan condicionalmente mediante `{viewMode === 'engineer' && <.../>}` para evitar abrumar a perfiles financieros (Executive).\\n")

if __name__ == "__main__":
    deploy()
    print("View Mode Module Deploy completed.")
