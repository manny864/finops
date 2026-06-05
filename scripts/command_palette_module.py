import os

base_dir = "/Users/manuelchavez/Documents/FinOpsProyect"

def deploy():
    # 1. Create Command Palette Component
    print("Creando CommandPalette.tsx...")
    comp_path = os.path.join(base_dir, "src/components/CommandPalette.tsx")
    with open(comp_path, "w") as f:
        f.write(""""use client";
import React, { useEffect, useState, useCallback } from 'react';
import { Command } from 'cmdk';
import { useRouter } from 'next/navigation';
import { LayoutDashboard, FileText, Activity, Trash2, Clock, Tag, ShieldCheck, Play } from 'lucide-react';

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      // Support for both Cmd+K (Mac) and Ctrl+K (Windows/Linux)
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((open) => !open);
      }
    };
    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, []);
  
  const runCommand = useCallback((command: () => unknown) => {
    setOpen(false);
    command();
  }, []);
  
  return (
    <Command.Dialog 
      open={open} 
      onOpenChange={setOpen} 
      label="Global Command Menu"
      className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh] bg-gray-900/40 backdrop-blur-sm"
    >
      <div className="w-full max-w-2xl bg-white rounded-xl shadow-2xl overflow-hidden border border-gray-200 animate-in fade-in zoom-in-95 duration-200">
        <Command.Input 
           placeholder="Busca comandos, vistas de FinOps o recursos... (⌘K / Ctrl+K)" 
           className="w-full px-5 py-4 text-lg border-b border-gray-100 outline-none placeholder:text-gray-400 text-gray-900 bg-transparent font-medium"
        />
        <Command.List className="max-h-[350px] overflow-y-auto p-2 scroll-py-2 custom-scrollbar">
          <Command.Empty className="py-10 text-center text-sm text-gray-500">
            No se encontraron rutas o comandos.
          </Command.Empty>

          <Command.Group heading="Navegación" className="px-3 py-2 text-xs font-bold text-gray-400 uppercase tracking-wider">
            <Command.Item onSelect={() => runCommand(() => router.push('/'))} className="cursor-pointer px-3 py-2.5 mt-1 text-sm font-semibold text-gray-700 rounded-lg hover:bg-indigo-50 hover:text-indigo-700 aria-selected:bg-indigo-50 aria-selected:text-indigo-700 transition-colors flex items-center">
              <LayoutDashboard className="w-4 h-4 mr-3 text-gray-400 aria-selected:text-indigo-500" />
              Dashboard Principal
            </Command.Item>
            <Command.Item onSelect={() => runCommand(() => router.push('/intelligence/billing'))} className="cursor-pointer px-3 py-2.5 mt-1 text-sm font-semibold text-gray-700 rounded-lg hover:bg-indigo-50 hover:text-indigo-700 aria-selected:bg-indigo-50 aria-selected:text-indigo-700 transition-colors flex items-center">
              <FileText className="w-4 h-4 mr-3 text-gray-400 aria-selected:text-indigo-500" />
              Facturación Mensual
            </Command.Item>
            <Command.Item onSelect={() => runCommand(() => router.push('/intelligence/rightsizing'))} className="cursor-pointer px-3 py-2.5 mt-1 text-sm font-semibold text-gray-700 rounded-lg hover:bg-indigo-50 hover:text-indigo-700 aria-selected:bg-indigo-50 aria-selected:text-indigo-700 transition-colors flex items-center">
              <Activity className="w-4 h-4 mr-3 text-gray-400 aria-selected:text-indigo-500" />
              Rightsizing de VMs
            </Command.Item>
            <Command.Item onSelect={() => runCommand(() => router.push('/cleanup/zombies'))} className="cursor-pointer px-3 py-2.5 mt-1 text-sm font-semibold text-gray-700 rounded-lg hover:bg-indigo-50 hover:text-indigo-700 aria-selected:bg-indigo-50 aria-selected:text-indigo-700 transition-colors flex items-center">
              <Trash2 className="w-4 h-4 mr-3 text-gray-400 aria-selected:text-indigo-500" />
              Recursos Zombis
            </Command.Item>
            <Command.Item onSelect={() => runCommand(() => router.push('/cleanup/ttl'))} className="cursor-pointer px-3 py-2.5 mt-1 text-sm font-semibold text-gray-700 rounded-lg hover:bg-indigo-50 hover:text-indigo-700 aria-selected:bg-indigo-50 aria-selected:text-indigo-700 transition-colors flex items-center">
              <Clock className="w-4 h-4 mr-3 text-gray-400 aria-selected:text-indigo-500" />
              Políticas TTL
            </Command.Item>
            <Command.Item onSelect={() => runCommand(() => router.push('/governance/tags'))} className="cursor-pointer px-3 py-2.5 mt-1 text-sm font-semibold text-gray-700 rounded-lg hover:bg-indigo-50 hover:text-indigo-700 aria-selected:bg-indigo-50 aria-selected:text-indigo-700 transition-colors flex items-center">
              <Tag className="w-4 h-4 mr-3 text-gray-400 aria-selected:text-indigo-500" />
              Gestión de Etiquetas
            </Command.Item>
            <Command.Item onSelect={() => runCommand(() => router.push('/admin/onboarding'))} className="cursor-pointer px-3 py-2.5 mt-1 text-sm font-semibold text-gray-700 rounded-lg hover:bg-indigo-50 hover:text-indigo-700 aria-selected:bg-indigo-50 aria-selected:text-indigo-700 transition-colors flex items-center">
              <ShieldCheck className="w-4 h-4 mr-3 text-gray-400 aria-selected:text-indigo-500" />
              Onboarding de Clientes
            </Command.Item>
          </Command.Group>

          <Command.Group heading="Acciones Rápidas" className="px-3 py-2 mt-2 text-xs font-bold text-gray-400 uppercase tracking-wider border-t border-gray-100">
            <Command.Item onSelect={() => runCommand(() => router.push('/cleanup/zombies'))} className="cursor-pointer px-3 py-2.5 mt-1 text-sm font-semibold text-gray-700 rounded-lg hover:bg-indigo-50 hover:text-indigo-700 aria-selected:bg-indigo-50 aria-selected:text-indigo-700 transition-colors flex items-center group">
              <div className="w-6 h-6 mr-3 rounded-full bg-indigo-100 group-hover:bg-indigo-200 flex items-center justify-center">
                  <Play className="w-3 h-3 text-indigo-600" />
              </div>
              Ejecutar Auditoría FinOps
            </Command.Item>
          </Command.Group>
        </Command.List>
      </div>
    </Command.Dialog>
  );
}
""")

    # 2. Update layout.tsx
    print("Actualizando layout.tsx...")
    layout_path = os.path.join(base_dir, "src/app/layout.tsx")
    with open(layout_path, "r") as f:
        layout_content = f.read()

    if "CommandPalette" not in layout_content:
        layout_content = layout_content.replace(
            "import ClientShell from \"@/components/ClientShell\";",
            "import ClientShell from \"@/components/ClientShell\";\nimport CommandPalette from \"@/components/CommandPalette\";"
        )
        
        layout_content = layout_content.replace(
            "<ClientShell>",
            "<ClientShell>\n          <CommandPalette />"
        )

        with open(layout_path, "w") as f:
            f.write(layout_content)
            
    print("Generando SOP...")
    sop_path = os.path.join(base_dir, "directivas/command_palette_SOP.md")
    os.makedirs(os.path.dirname(sop_path), exist_ok=True)
    with open(sop_path, "w") as f:
        f.write("# Command Palette SOP\\n\\n")
        f.write("- **Atajo de Teclado Uniforme**: La escucha de eventos se programa como `(e.metaKey || e.ctrlKey) && e.key === 'k'` para soportar macOS y Windows/Linux orgánicamente.\\n")
        f.write("- **Accesibilidad (a11y)**: Se utiliza `cmdk` para heredar las reglas WAI-ARIA de Radix UI, asegurando navegación con flechas de teclado y `Enter` para las vistas FinOps.\\n")
        f.write("- **Arquitectura Híbrida**: Al montar el componente cliente (`<CommandPalette />`) directamente dentro de `layout.tsx`, logramos que esté suspendido sobre todas las vistas simultáneamente.\\n")

if __name__ == "__main__":
    deploy()
    print("Command Palette Module Deploy completed.")
