"use client";
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
