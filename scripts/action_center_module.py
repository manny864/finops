import os

base_dir = "/Users/manuelchavez/Documents/FinOpsProyect"

def deploy():
    print("Creando actionLogStore.ts...")
    store_dir = os.path.join(base_dir, "src/store")
    os.makedirs(store_dir, exist_ok=True)
    with open(os.path.join(store_dir, "actionLogStore.ts"), "w") as f:
        f.write("""import { create } from 'zustand';

export interface ActionLog {
    id: string;
    message: string;
    timestamp: Date;
    status: 'success' | 'error' | 'info';
}

interface ActionLogState {
    actions: ActionLog[];
    addAction: (action: Omit<ActionLog, 'id' | 'timestamp'>) => void;
    clearActions: () => void;
}

export const useActionLogStore = create<ActionLogState>((set) => ({
    actions: [],
    addAction: (action) => set((state) => ({
        actions: [{ ...action, id: crypto.randomUUID(), timestamp: new Date() }, ...state.actions]
    })),
    clearActions: () => set({ actions: [] })
}));
""")

    print("Creando ActionCenterDrawer.tsx...")
    drawer_path = os.path.join(base_dir, "src/components/ActionCenterDrawer.tsx")
    with open(drawer_path, "w") as f:
        f.write(""""use client";
import React from 'react';
import { useActionLogStore } from '@/store/actionLogStore';
import { X, CheckCircle, AlertCircle, Info, Trash2 } from 'lucide-react';

interface DrawerProps {
    open: boolean;
    onClose: () => void;
}

export default function ActionCenterDrawer({ open, onClose }: DrawerProps) {
    const { actions, clearActions } = useActionLogStore();

    return (
        <>
            {open && <div className="fixed inset-0 bg-black/20 dark:bg-black/40 backdrop-blur-sm z-40 transition-opacity" onClick={onClose} />}
            
            <div className={`fixed top-0 right-0 h-full w-96 bg-white dark:bg-slate-900 shadow-2xl z-50 transform transition-transform duration-300 ease-in-out border-l border-gray-200 dark:border-slate-800 flex flex-col ${open ? 'translate-x-0' : 'translate-x-full'}`}>
                <div className="h-16 px-6 border-b border-gray-200 dark:border-slate-800 flex items-center justify-between shrink-0 bg-gray-50 dark:bg-slate-950">
                    <h2 className="text-lg font-bold tracking-tight text-gray-900 dark:text-white">Centro de Acciones</h2>
                    <button onClick={onClose} className="p-2 rounded-full hover:bg-gray-200 dark:hover:bg-slate-800 text-gray-500 transition-colors">
                        <X className="w-5 h-5" />
                    </button>
                </div>
                
                <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
                    {actions.length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center text-center text-gray-500">
                            <Info className="w-10 h-10 mb-3 text-gray-300 dark:text-slate-700" />
                            <p>No hay acciones recientes.</p>
                        </div>
                    ) : (
                        actions.map(action => (
                            <div key={action.id} className="p-4 rounded-lg border border-gray-100 dark:border-slate-800 bg-white dark:bg-slate-800/50 shadow-sm flex items-start gap-3">
                                <div className="mt-0.5">
                                    {action.status === 'success' && <CheckCircle className="w-5 h-5 text-green-500" />}
                                    {action.status === 'error' && <AlertCircle className="w-5 h-5 text-red-500" />}
                                    {action.status === 'info' && <Info className="w-5 h-5 text-blue-500" />}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{action.message}</p>
                                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                        {action.timestamp.toLocaleTimeString()} - {action.timestamp.toLocaleDateString()}
                                    </p>
                                </div>
                            </div>
                        ))
                    )}
                </div>
                
                {actions.length > 0 && (
                    <div className="p-4 border-t border-gray-200 dark:border-slate-800 bg-gray-50 dark:bg-slate-950 shrink-0">
                        <button onClick={clearActions} className="w-full flex items-center justify-center py-2 px-4 border border-gray-300 dark:border-slate-700 rounded-md shadow-sm text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-slate-800 hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors">
                            <Trash2 className="w-4 h-4 mr-2" /> Limpiar Historial
                        </button>
                    </div>
                )}
            </div>
        </>
    );
}
""")

    print("Actualizando layout.tsx...")
    layout_path = os.path.join(base_dir, "src/app/layout.tsx")
    with open(layout_path, "r") as f:
        layout = f.read()
    
    if "Toaster" not in layout:
        layout = layout.replace(
            "import { ThemeProvider",
            "import { Toaster } from 'sonner';\nimport { ThemeProvider"
        )
        layout = layout.replace(
            "<ClientShell>",
            "<Toaster richColors position=\"bottom-right\" theme=\"system\" />\n          <ClientShell>"
        )
        with open(layout_path, "w") as f:
            f.write(layout)

    print("Actualizando ClientShell.tsx...")
    shell_path = os.path.join(base_dir, "src/components/ClientShell.tsx")
    with open(shell_path, "r") as f:
        shell = f.read()

    if "ActionCenterDrawer" not in shell:
        shell = shell.replace(
            "import { Menu",
            "import { Menu, Bell"
        )
        shell = shell.replace(
            "import { useViewMode }",
            "import { useViewMode }\nimport { useActionLogStore } from '@/store/actionLogStore';\nimport ActionCenterDrawer from './ActionCenterDrawer';"
        )
        shell = shell.replace(
            "const [sidebarOpen, setSidebarOpen] = useState(true);",
            "const [sidebarOpen, setSidebarOpen] = useState(true);\n    const [drawerOpen, setDrawerOpen] = useState(false);\n    const { actions } = useActionLogStore();"
        )
        # Añadir campana en el header, junto a los toggle de viewMode
        bell_jsx = """
                <button 
                    onClick={() => setDrawerOpen(true)}
                    className="relative p-2 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors mr-2"
                >
                    <Bell className="w-5 h-5" />
                    {actions.length > 0 && (
                        <span className="absolute top-1.5 right-1.5 flex h-2 w-2">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
                        </span>
                    )}
                </button>
                """
        shell = shell.replace(
            "className=\"hidden md:flex items-center",
            bell_jsx + "\n                <div className=\"hidden md:flex items-center"
        )
        shell = shell.replace(
            "</div>\n            <div className=\"flex-1",
            "</div>\n            <ActionCenterDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />\n            <div className=\"flex-1"
        )
        with open(shell_path, "w") as f:
            f.write(shell)

    print("Actualizando ZombieResourcesTable.tsx...")
    zombies_path = os.path.join(base_dir, "src/components/ZombieResourcesTable.tsx")
    with open(zombies_path, "r") as f:
        zombies = f.read()

    if "sonner" not in zombies:
        zombies = zombies.replace(
            "import RoleAssignmentBanner",
            "import RoleAssignmentBanner\nimport { toast } from 'sonner';\nimport { useActionLogStore } from '@/store/actionLogStore';"
        )
        zombies = zombies.replace(
            "const { viewMode } = useViewMode();",
            "const { viewMode } = useViewMode();\n  const { addAction } = useActionLogStore();"
        )
        
        # Modify handleDelete
        zombies = zombies.replace(
            "alert(`La eliminación automática de [${item.type}] requiere",
            "toast.error('Requisito Manual', { description: `La eliminación de [${item.type}] debe hacerse en el portal.` }); return; //"
        )
        
        zombies = zombies.replace(
            "alert(`¡Operación Denegada por Azure!",
            "toast.error('¡Operación Denegada!', { description: 'Tu aplicación FinOps solo tiene rol de Lector.' });\n              addAction({ message: `Fallo de permisos al borrar ${item.resourceName}. Se requiere Rol Contributor.`, status: 'error' }); //"
        )
        
        zombies = zombies.replace(
            "alert(`Error al borrar: ${err.message || 'Sin permisos suficientes.'}`);",
            "toast.error('Error al borrar', { description: err.message });\n              addAction({ message: `Error al borrar ${item.resourceName}: ${err.message}`, status: 'error' });"
        )
        
        zombies = zombies.replace(
            "// Remover de la tabla local\n          setData(prev => prev.filter(r => r.id !== item.id));",
            "// Remover de la tabla local\n          setData(prev => prev.filter(r => r.id !== item.id));\n          toast.success('Recurso Eliminado', { description: `${item.resourceName} fue destruido.` });\n          addAction({ message: `Se eliminó el recurso zombi: ${item.resourceName} exitosamente.`, status: 'success' });"
        )
        with open(zombies_path, "w") as f:
            f.write(zombies)

    print("Actualizando ttl/page.tsx...")
    ttl_path = os.path.join(base_dir, "src/app/cleanup/ttl/page.tsx")
    with open(ttl_path, "r") as f:
        ttl = f.read()

    if "sonner" not in ttl:
        ttl = ttl.replace(
            "import { Clock",
            "import { toast } from 'sonner';\nimport { useActionLogStore } from '@/store/actionLogStore';\nimport { Clock"
        )
        ttl = ttl.replace(
            "const [deletingId, setDeletingId] = useState<string | null>(null);",
            "const [deletingId, setDeletingId] = useState<string | null>(null);\n  const { addAction } = useActionLogStore();"
        )
        
        ttl = ttl.replace(
            "alert(\"Error al eliminar: \" + (json.error || \"Fallo desconocido\"));",
            "toast.error('Error al eliminar', { description: json.error });\n              addAction({ message: `Fallo al eliminar entorno TTL: ${resourceId}`, status: 'error' });"
        )
        
        ttl = ttl.replace(
            "setResources(prev => prev.filter(r => r.id !== resourceId));",
            "setResources(prev => prev.filter(r => r.id !== resourceId));\n              toast.success('Entorno Destruido');\n              addAction({ message: `Entorno TTL expirado destruido exitosamente.`, status: 'success' });"
        )
        
        ttl = ttl.replace(
            "alert(\"Error de red al intentar eliminar\");",
            "toast.error('Error de red al intentar eliminar');\n          addAction({ message: `Error de red eliminando entorno TTL.`, status: 'error' });"
        )
        with open(ttl_path, "w") as f:
            f.write(ttl)

    print("Generando SOP...")
    sop_path = os.path.join(base_dir, "directivas/action_center_SOP.md")
    os.makedirs(os.path.dirname(sop_path), exist_ok=True)
    with open(sop_path, "w") as f:
        f.write("# Action Center & Notifications SOP\\n\\n")
        f.write("- **Toasts**: Usamos `sonner` para disparar notificaciones flotantes ricas (`toast.success`, `toast.error`) reemplazando los intrusivos `alert()` de navegador.\\n")
        f.write("- **Global Log (Zustand)**: `useActionLogStore` guarda cada operación (con timestamp y estatus) para que los FinOps Managers puedan tener trazabilidad inmediata de lo ocurrido en la sesión.\\n")
        f.write("- **Drawer**: El `ActionCenterDrawer` se vincula a la campana (Bell) global en el `ClientShell` para ofrecer un slide-out lateral estilo Azure Portal Notifications.\\n")

if __name__ == "__main__":
    deploy()
    print("Action Center Module Deploy completed.")
