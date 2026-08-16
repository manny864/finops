import { ReactNode } from "react";
import { Inter } from "next/font/google";
import { getTranslations } from "next-intl/server";
import RouteTabsNav from "@/components/navigation/RouteTabsNav";
import { IconCoins } from "@tabler/icons-react";
import { Activity, PieChart, Wallet, Layers, Building2, ChartLine, FileSpreadsheet } from "lucide-react";
import InfoTooltip from "@/components/InfoTooltip";

const inter = Inter({ subsets: ["latin"] });

export default async function ConsumoPresupuestoLayout({ children }: { children: ReactNode }) {
    const t = await getTranslations("ConsumptionBudgetsHub");

    const tabs = [
        { href: "/intelligence/consumo-y-presupuesto", label: t("tabRealConsumption"), icon: <Activity className="w-4 h-4 text-[#0054A6]" />, tooltip: t("tooltip_tab_real_consumption") },
        { href: "/intelligence/consumo-y-presupuesto/por-categoria", label: t("tabByCategory"), icon: <PieChart className="w-4 h-4 text-[#0054A6]" />, tooltip: t("tooltip_tab_by_category") },
        { href: "/intelligence/consumo-y-presupuesto/presupuestos", label: t("tabBudgets"), icon: <Wallet className="w-4 h-4 text-[#0054A6]" />, tooltip: t("tooltip_tab_budgets") },
        { href: "/intelligence/consumo-y-presupuesto/grupos-de-costos", label: t("tabCostGroups"), icon: <Layers className="w-4 h-4 text-[#0054A6]" />, tooltip: t("tooltip_tab_cost_groups") },
        { href: "/intelligence/consumo-y-presupuesto/presupuesto-por-grupos-de-costos", label: t("tabCostGroupBudgets"), icon: <Building2 className="w-4 h-4 text-[#0054A6]" />, tooltip: t("tooltip_tab_cost_group_budgets") },
        { href: "/intelligence/consumo-y-presupuesto/gastos-y-proyeccion", label: t("tabForecast"), icon: <ChartLine className="w-4 h-4 text-[#0054A6]" />, tooltip: t("tooltip_tab_forecast") },
        { href: "/intelligence/consumo-y-presupuesto/ingesta-csv", label: t("tabCsvIngest"), icon: <FileSpreadsheet className="w-4 h-4 text-[#0054A6]" />, tooltip: t("tooltip_tab_csv_ingest") },
    ];

    return (
        <div className={inter.className}>
            <div className="px-6 pt-4">
                <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                    <IconCoins className="w-6 h-6 text-[#0054A6]" />
                    <span>{t("title")}</span>
                    <InfoTooltip content={t("tooltip_title")} position="bottom" align="left" />
                </h1>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{t("subtitle")}</p>
            </div>
            <RouteTabsNav tabs={tabs} className="px-6 mt-4 mb-4" />
            {children}
        </div>
    );
}
