import { ReactNode } from "react";
import { Inter } from "next/font/google";
import { getTranslations } from "next-intl/server";
import RouteTabsNav from "@/components/navigation/RouteTabsNav";
import { Database, Orbit, DatabaseZap, Leaf, AppWindow } from "lucide-react";

const inter = Inter({ subsets: ["latin"] });

export default async function BasesDatosLayout({ children }: { children: ReactNode }) {
    const t = await getTranslations("DatabasesHub");

    const tabs = [
        { href: "/intelligence/bases-de-datos", label: t("tabCosmos"), icon: <Orbit className="w-4 h-4 text-[#0054A6]" /> },
        { href: "/intelligence/bases-de-datos/azure-sql-sql-managed-instance", label: t("tabSql"), icon: <DatabaseZap className="w-4 h-4 text-[#0054A6]" /> },
        { href: "/intelligence/bases-de-datos/postgresql", label: t("tabPostgresql"), icon: <Database className="w-4 h-4 text-[#0054A6]" /> },
        { href: "/intelligence/bases-de-datos/mongodb", label: t("tabMongoDb"), icon: <Leaf className="w-4 h-4 text-[#0054A6]" /> },
        { href: "/intelligence/bases-de-datos/redistest", label: t("tabRedistest"), icon: <AppWindow className="w-4 h-4 text-[#0054A6]" /> },
        { href: "/intelligence/bases-de-datos/testmysql", label: t("tabTestmysql"), icon: <Database className="w-4 h-4 text-[#0054A6]" /> },
    ];

    return (
        <div className={inter.className}>
            <div className="px-6 pt-4">
                <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                    <Database className="w-6 h-6 text-[#0054A6]" />
                    {t("title")}
                </h1>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{t("subtitle")}</p>
            </div>
            <RouteTabsNav tabs={tabs} className="px-6 mt-4 mb-4" />
            {children}
        </div>
    );
}
