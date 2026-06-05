import os

base_dir = "/Users/manuelchavez/Documents/FinOpsProyect"

def deploy():
    print("Actualizando globals.css...")
    css_path = os.path.join(base_dir, "src/app/globals.css")
    with open(css_path, "r") as f:
        css = f.read()
    
    # Enable class-based dark mode for Tailwind v4
    if "@custom-variant dark" not in css:
        css = css.replace('@import "tailwindcss";', '@import "tailwindcss";\n@custom-variant dark (&:where(.dark, .dark *));\n')
    
    if "@media (prefers-color-scheme: dark)" in css:
        css = css.replace(
            "@media (prefers-color-scheme: dark) {\n  :root {",
            ".dark {"
        ).replace(
            "    --background: #0a0a0a;\n    --foreground: #ededed;\n  }\n}",
            "  --background: #0f172a;\n  --foreground: #f8fafc;\n}"
        )
    
    with open(css_path, "w") as f:
        f.write(css)

    print("Creando ThemeProvider.tsx...")
    prov_path = os.path.join(base_dir, "src/components/ThemeProvider.tsx")
    with open(prov_path, "w") as f:
        f.write(""""use client";
import * as React from "react";
import { ThemeProvider as NextThemesProvider } from "next-themes";

export function ThemeProvider({ children, ...props }: any) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>;
}
""")

    print("Actualizando layout.tsx...")
    layout_path = os.path.join(base_dir, "src/app/layout.tsx")
    with open(layout_path, "r") as f:
        layout = f.read()
    
    if "ThemeProvider" not in layout:
        layout = layout.replace(
            "import ClientShell", 
            "import { ThemeProvider } from \"@/components/ThemeProvider\";\nimport ClientShell"
        )
        layout = layout.replace(
            "<ClientShell>", 
            "<ThemeProvider attribute=\"class\" defaultTheme=\"system\" enableSystem>\n          <ClientShell>"
        )
        layout = layout.replace(
            "</ClientShell>", 
            "</ClientShell>\n          </ThemeProvider>"
        )
        layout = layout.replace("<html lang=\"es\" className=", "<html lang=\"es\" suppressHydrationWarning className=")
        with open(layout_path, "w") as f:
            f.write(layout)

    print("Creando vista de Configuración...")
    config_dir = os.path.join(base_dir, "src/app/admin/config")
    os.makedirs(config_dir, exist_ok=True)
    with open(os.path.join(config_dir, "page.tsx"), "w") as f:
        f.write(""""use client";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Monitor, Moon, Sun, Settings } from "lucide-react";

export default function ConfigPage() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  return (
    <div className="p-6 max-w-4xl mx-auto animate-in fade-in duration-500">
      <div className="mb-8 border-b border-gray-200 dark:border-gray-800 pb-4">
        <h1 className="text-3xl font-extrabold text-gray-900 dark:text-white tracking-tight flex items-center">
            <Settings className="w-8 h-8 mr-3 text-[#0054A6] dark:text-[#00AEEF]" />
            Configuración Global
        </h1>
        <p className="text-gray-500 dark:text-gray-400 mt-2">Personaliza la apariencia y el comportamiento de la plataforma FinOps.</p>
      </div>

      <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 dark:border-slate-800 bg-gray-50/50 dark:bg-slate-900/50">
            <h3 className="text-lg font-bold text-gray-800 dark:text-gray-100">Apariencia</h3>
        </div>
        <div className="p-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between">
                <div>
                    <h4 className="font-semibold text-gray-900 dark:text-white">Tema de la Interfaz</h4>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Selecciona cómo deseas visualizar la plataforma.</p>
                </div>
                
                <div className="mt-4 md:mt-0 flex p-1 bg-gray-100 dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700">
                    <button
                        onClick={() => setTheme('light')}
                        className={`flex items-center px-4 py-2 text-sm font-semibold rounded-md transition-all ${theme === 'light' ? 'bg-white dark:bg-slate-700 shadow-sm text-[#0054A6] dark:text-[#00AEEF]' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'}`}
                    >
                        <Sun className="w-4 h-4 mr-2" />
                        Claro
                    </button>
                    <button
                        onClick={() => setTheme('dark')}
                        className={`flex items-center px-4 py-2 text-sm font-semibold rounded-md transition-all ${theme === 'dark' ? 'bg-white dark:bg-slate-700 shadow-sm text-[#0054A6] dark:text-[#00AEEF]' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'}`}
                    >
                        <Moon className="w-4 h-4 mr-2" />
                        Oscuro
                    </button>
                    <button
                        onClick={() => setTheme('system')}
                        className={`flex items-center px-4 py-2 text-sm font-semibold rounded-md transition-all ${theme === 'system' ? 'bg-white dark:bg-slate-700 shadow-sm text-[#0054A6] dark:text-[#00AEEF]' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'}`}
                    >
                        <Monitor className="w-4 h-4 mr-2" />
                        Automático
                    </button>
                </div>
            </div>
        </div>
      </div>
    </div>
  );
}
""")

    print("Actualizando Sidebar.tsx...")
    sidebar_path = os.path.join(base_dir, "src/components/Sidebar.tsx")
    with open(sidebar_path, "r") as f:
        sidebar = f.read()

    if "Settings" not in sidebar:
        sidebar = sidebar.replace(
            "Users,",
            "Users,\n    Settings,"
        )
        sidebar = sidebar.replace(
            "{ href: '/admin/onboarding', label: 'Onboarding Clientes', icon: Users }",
            "{ href: '/admin/onboarding', label: 'Onboarding Clientes', icon: Users },\n                { href: '/admin/config', label: 'Configuración', icon: Settings }"
        )
        with open(sidebar_path, "w") as f:
            f.write(sidebar)

    print("Actualizando ClientShell.tsx (Dark Mode base)...")
    shell_path = os.path.join(base_dir, "src/components/ClientShell.tsx")
    with open(shell_path, "r") as f:
        shell = f.read()

    if "dark:bg-slate-950" not in shell:
        shell = shell.replace('className="min-h-screen bg-gray-50 flex text-gray-900"', 'className="min-h-screen bg-gray-50 dark:bg-slate-950 flex text-gray-900 dark:text-gray-100"')
        shell = shell.replace('className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-6 z-10 shadow-sm"', 'className="h-16 bg-white dark:bg-slate-900 border-b border-gray-200 dark:border-slate-800 flex items-center justify-between px-6 z-10 shadow-sm"')
        shell = shell.replace('className="text-xl font-bold text-gray-800 hidden sm:block tracking-tight"', 'className="text-xl font-bold text-gray-800 dark:text-white hidden sm:block tracking-tight"')
        shell = shell.replace('className="hidden md:flex items-center border border-gray-200 rounded-lg px-2 py-1 bg-gray-50 relative"', 'className="hidden md:flex items-center border border-gray-200 dark:border-slate-700 rounded-lg px-2 py-1 bg-gray-50 dark:bg-slate-800 relative"')
        shell = shell.replace('className="text-sm font-semibold text-gray-700 bg-transparent', 'className="text-sm font-semibold text-gray-700 dark:text-gray-200 bg-transparent dark:bg-slate-800')
        shell = shell.replace('className="flex-1 overflow-y-auto bg-gray-50/50 p-6"', 'className="flex-1 overflow-y-auto bg-gray-50/50 dark:bg-slate-950/50 p-6"')
        shell = shell.replace('bg-gray-100 rounded-lg p-1 mr-4 border border-gray-200', 'bg-gray-100 dark:bg-slate-800 rounded-lg p-1 mr-4 border border-gray-200 dark:border-slate-700')
        with open(shell_path, "w") as f:
            f.write(shell)

    print("Actualizando Sidebar.tsx (Dark Mode base)...")
    with open(sidebar_path, "r") as f:
        sidebar = f.read()
    
    if "dark:bg-slate-900" not in sidebar:
        sidebar = sidebar.replace('bg-white border-r border-gray-200', 'bg-white dark:bg-slate-900 border-r border-gray-200 dark:border-slate-800')
        sidebar = sidebar.replace('border-b border-gray-200 px-4', 'border-b border-gray-200 dark:border-slate-800 px-4')
        sidebar = sidebar.replace('text-gray-600 hover:bg-gray-100 hover:text-gray-900', 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-800 hover:text-gray-900 dark:hover:text-white')
        with open(sidebar_path, "w") as f:
            f.write(sidebar)

    print("Generando SOP...")
    sop_path = os.path.join(base_dir, "directivas/dark_mode_SOP.md")
    os.makedirs(os.path.dirname(sop_path), exist_ok=True)
    with open(sop_path, "w") as f:
        f.write("# Dark Mode SOP\\n\\n")
        f.write("- **Arquitectura Híbrida Tailwind 4**: Usamos custom-variant dark en globals.css para permitir alternado por clase.\\n")
        f.write("- **Next-Themes**: El proveedor ThemeProvider envuelve ClientShell con attribute class y suppressHydrationWarning en la raíz html.\\n")
        f.write("- **Adopción Temática**: Se inyectaron gradualmente las variantes dark: en los componentes estructurales (Header, Sidebar, Shell, etc).\\n")

if __name__ == "__main__":
    deploy()
    print("Dark Mode Deploy completed.")
