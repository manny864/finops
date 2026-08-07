import { ReactNode } from "react";
import { Inter } from "next/font/google";
import RouteTabsNav from "@/components/navigation/RouteTabsNav";
import { IconCoins } from "@tabler/icons-react";
import { Activity, PieChart, Leaf, Wallet, Layers, Building2, ChartLine, FileSpreadsheet } from "lucide-react";

const inter = Inter({ subsets: ["latin"] });

const tabs = [
    { href: "/intelligence/consumo-y-presupuesto", label: "Consumo Real", icon: <Activity className="w-4 h-4 text-[#0054A6]" /> },
    { href: "/intelligence/consumo-y-presupuesto/por-categoria", label: "Por Categoría", icon: <PieChart className="w-4 h-4 text-[#0054A6]" /> },
    { href: "/intelligence/consumo-y-presupuesto/impacto-ambiental", label: "Impacto Ambiental", icon: <Leaf className="w-4 h-4 text-[#0054A6]" /> },
    { href: "/intelligence/consumo-y-presupuesto/presupuestos", label: "Presupuestos", icon: <Wallet className="w-4 h-4 text-[#0054A6]" /> },
    { href: "/intelligence/consumo-y-presupuesto/grupos-de-costos", label: "Grupos de Costos", icon: <Layers className="w-4 h-4 text-[#0054A6]" /> },
    { href: "/intelligence/consumo-y-presupuesto/presupuesto-por-grupos-de-costos", label: "Presupuesto por Grupos de Costos", icon: <Building2 className="w-4 h-4 text-[#0054A6]" /> },
    { href: "/intelligence/consumo-y-presupuesto/gastos-y-proyeccion", label: "Gastos y Proyección", icon: <ChartLine className="w-4 h-4 text-[#0054A6]" /> },
    { href: "/intelligence/consumo-y-presupuesto/ingesta-csv", label: "Ingesta CSV", icon: <FileSpreadsheet className="w-4 h-4 text-[#0054A6]" /> },
];

export default function ConsumoPresupuestoLayout({ children }: { children: ReactNode }) {
    return (
        <div className={inter.className}>
            <div className="px-6 pt-4">
                <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                    <IconCoins className="w-6 h-6 text-[#0054A6]" />
                    Consumo y Presupuesto
                </h1>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Gestión integral de consumo, presupuestos y proyección.</p>
            </div>
            <RouteTabsNav tabs={tabs} className="px-6 mt-4 mb-4" />
            {children}
        </div>
    );
}
