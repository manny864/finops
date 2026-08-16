import { ReactNode } from "react";
import { Inter } from "next/font/google";
import { getTranslations } from "next-intl/server";
import RouteTabsNav from "@/components/navigation/RouteTabsNav";
import { Cpu, AppWindow, FunctionSquare, Monitor, Scaling, Server } from "lucide-react";
import InfoTooltip from "@/components/InfoTooltip";

const inter = Inter({ subsets: ["latin"] });

export default async function ComputoLayout({ children }: { children: ReactNode }) {
    const t = await getTranslations("ComputeHub");
    const tabs = [
        { href: "/intelligence/computo", label: t("tabComputeEfficiency"), icon: <Cpu className="w-4 h-4 text-[#0054A6]" />, tooltip: t("tooltip_tab_compute_efficiency") },
        { href: "/intelligence/computo/kubernetes", label: t("tabKubernetes", { fallback: "Kubernetes" }), icon: <Server className="w-4 h-4 text-[#0054A6]" />, tooltip: t("tooltip_tab_kubernetes") },
        { href: "/intelligence/computo/capp", label: t("tabContainersFinopsCmp"), icon: <Server className="w-4 h-4 text-[#0054A6]" />, tooltip: t("tooltip_tab_containers") },
        { href: "/intelligence/computo/waas", label: t("tabWebAppsFinopsCmp"), icon: <AppWindow className="w-4 h-4 text-[#0054A6]" />, tooltip: t("tooltip_tab_web_apps") },
        { href: "/intelligence/computo/fapps", label: t("tabFunctionsFinopsCmp"), icon: <FunctionSquare className="w-4 h-4 text-[#0054A6]" />, tooltip: t("tooltip_tab_functions") },
        { href: "/intelligence/computo/avm", label: t("tabVirtualMachinesFinopsCmp"), icon: <Monitor className="w-4 h-4 text-[#0054A6]" />, tooltip: t("tooltip_tab_virtual_machines") },
        { href: "/intelligence/computo/vmss", label: t("tabVmssFinopsCmp"), icon: <Scaling className="w-4 h-4 text-[#0054A6]" />, tooltip: t("tooltip_tab_vmss") },
        { href: "/intelligence/computo/arhos", label: t("tabAroFinopsCmp"), icon: <Server className="w-4 h-4 text-[#0054A6]" />, tooltip: t("tooltip_tab_aro") },
    ];

    return (
        <div className={inter.className}>
            <div className="px-6 pt-4">
                <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                    <Cpu className="w-6 h-6 text-[#0054A6]" />
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
