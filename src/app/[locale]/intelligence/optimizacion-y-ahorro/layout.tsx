import { ReactNode } from "react";
import { Inter } from "next/font/google";
import RouteTabsNav from "@/components/navigation/RouteTabsNav";
import { Target, Cpu, Coins, Tag, ShieldCheck, Package, Gauge } from "lucide-react";

const inter = Inter({ subsets: ["latin"] });

const tabs = [
    { href: "/intelligence/optimizacion-y-ahorro", label: "Rightsizing", icon: <Cpu className="w-4 h-4 text-[#0054A6]" /> },
    { href: "/intelligence/optimizacion-y-ahorro/optimizacion-de-tarifas", label: "Optimización de Tarifas", icon: <Coins className="w-4 h-4 text-[#0054A6]" /> },
    { href: "/intelligence/optimizacion-y-ahorro/beneficios-hibridos", label: "Beneficios Híbridos", icon: <Tag className="w-4 h-4 text-[#0054A6]" /> },
    { href: "/intelligence/optimizacion-y-ahorro/reservas-de-instancias-ris", label: "Reservas de Instancias (RIs)", icon: <ShieldCheck className="w-4 h-4 text-[#0054A6]" /> },
    { href: "/intelligence/optimizacion-y-ahorro/saving-plan", label: "Saving Plan", icon: <Coins className="w-4 h-4 text-[#0054A6]" /> },
    { href: "/intelligence/optimizacion-y-ahorro/costo-cero", label: "Costo Cero", icon: <Package className="w-4 h-4 text-[#0054A6]" /> },
    { href: "/intelligence/optimizacion-y-ahorro/indice-de-optimizacion", label: "Índice de Optimización", icon: <Gauge className="w-4 h-4 text-[#0054A6]" /> },
];

export default function OptimizacionAhorroLayout({ children }: { children: ReactNode }) {
    return (
        <div className={inter.className}>
            <div className="px-6 pt-4">
                <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                    <Target className="w-6 h-6 text-[#0054A6]" />
                    Optimización y Ahorro
                </h1>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Gestión de optimización de cómputo, tarifas y compromisos.</p>
            </div>
            <RouteTabsNav tabs={tabs} className="px-6 mt-4 mb-4" />
            {children}
        </div>
    );
}
