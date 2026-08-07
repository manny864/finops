import { ReactNode } from "react";
import { Inter } from "next/font/google";
import { getTranslations } from "next-intl/server";
import RouteTabsNav from "@/components/navigation/RouteTabsNav";
import RouteTabsFilter from "@/components/navigation/RouteTabsFilter";
import { IconTopologyStar3 } from "@tabler/icons-react";
import { Network, GitMerge, Shuffle, Globe } from "lucide-react";

const inter = Inter({ subsets: ["latin"] });

export default async function RedesLayout({ children }: { children: ReactNode }) {
    const t = await getTranslations("NetworkHub");

    const tabs = [
        { href: "/intelligence/redes", label: t("tabAnalysis"), icon: <Network className="w-4 h-4 text-[#0054A6]" /> },
        { href: "/intelligence/redes/redes-basicas", label: t("tabBasic"), icon: <Network className="w-4 h-4 text-[#0054A6]" /> },
        { href: "/intelligence/redes/conectividad-hibrida", label: t("tabHybrid"), icon: <GitMerge className="w-4 h-4 text-[#0054A6]" /> },
        { href: "/intelligence/redes/balanceo-y-publicacion", label: t("tabBalancing"), icon: <Shuffle className="w-4 h-4 text-[#0054A6]" /> },
        { href: "/intelligence/redes/acceso-a-internet", label: t("tabInternet"), icon: <Globe className="w-4 h-4 text-[#0054A6]" /> },
    ];

    return (
        <div className={inter.className}>
            <div className="px-6 pt-4">
                <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                    <IconTopologyStar3 className="w-6 h-6 text-[#0054A6]" />
                    {t("title")}
                </h1>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{t("subtitle")}</p>
            </div>
            <RouteTabsNav tabs={tabs} className="px-6 mt-4 mb-4" />
            <RouteTabsFilter />
            {children}
        </div>
    );
}
