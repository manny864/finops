import { ReactNode } from "react";
import { Inter } from "next/font/google";
import { getTranslations } from "next-intl/server";
import RouteTabsNav from "@/components/navigation/RouteTabsNav";
import { Target, Cpu, Coins, Tag, ShieldCheck, Package, Gauge } from "lucide-react";
import InfoTooltip from "@/components/InfoTooltip";

const inter = Inter({ subsets: ["latin"] });

export default async function OptimizacionAhorroLayout({ children }: { children: ReactNode }) {
    const t = await getTranslations("OptimizationSavingsHub");

    const tabs = [
        { href: "/intelligence/optimizacion-y-ahorro", label: t("tabRightsizing"), icon: <Cpu className="w-4 h-4 text-[#0054A6]" />, tooltip: t("tooltip_tab_rightsizing") },
        { href: "/intelligence/optimizacion-y-ahorro/optimizacion-de-tarifas", label: t("tabRates"), icon: <Coins className="w-4 h-4 text-[#0054A6]" />, tooltip: t("tooltip_tab_rates") },
        { href: "/intelligence/optimizacion-y-ahorro/beneficios-hibridos", label: t("tabHybridBenefit"), icon: <Tag className="w-4 h-4 text-[#0054A6]" />, tooltip: t("tooltip_tab_hybrid_benefit") },
        { href: "/intelligence/optimizacion-y-ahorro/reservas-de-instancias-ris", label: t("tabReservations"), icon: <ShieldCheck className="w-4 h-4 text-[#0054A6]" />, tooltip: t("tooltip_tab_reservations") },
        { href: "/intelligence/optimizacion-y-ahorro/saving-plan", label: t("tabSavingsPlans"), icon: <Coins className="w-4 h-4 text-[#0054A6]" />, tooltip: t("tooltip_tab_savings_plans") },
        { href: "/intelligence/optimizacion-y-ahorro/costo-cero", label: t("tabZeroCost"), icon: <Package className="w-4 h-4 text-[#0054A6]" />, tooltip: t("tooltip_tab_zero_cost") },
        { href: "/intelligence/optimizacion-y-ahorro/indice-de-optimizacion", label: t("tabOptimizationIndex"), icon: <Gauge className="w-4 h-4 text-[#0054A6]" />, tooltip: t("tooltip_tab_optimization_index") },
    ];

    return (
        <div className={inter.className}>
            <div className="px-6 pt-4">
                <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                    <Target className="w-6 h-6 text-[#0054A6]" />
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
