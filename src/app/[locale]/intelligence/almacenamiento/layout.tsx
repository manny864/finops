import { ReactNode } from "react";
import { Inter } from "next/font/google";
import { getTranslations } from "next-intl/server";
import RouteTabsNav from "@/components/navigation/RouteTabsNav";
import { IconDatabase } from "@tabler/icons-react";
import { Database, HardDrive, ShieldCheck } from "lucide-react";

const inter = Inter({ subsets: ["latin"] });

export default async function AlmacenamientoLayout({ children }: { children: ReactNode }) {
    const t = await getTranslations("StorageHub");

    const tabs = [
        { href: "/intelligence/almacenamiento/storage-accounts-finops-cmp", label: t("tabStorageAccountsFinopsCmp"), icon: <Database className="w-4 h-4 text-[#0054A6]" /> },
        { href: "/intelligence/almacenamiento/managed-disk-finops-cmp", label: t("tabManagedDiskFinopsCmp"), icon: <HardDrive className="w-4 h-4 text-[#0054A6]" /> },
        { href: "/intelligence/almacenamiento/backups-finops-cmp", label: t("tabBackupsFinopsCmp"), icon: <ShieldCheck className="w-4 h-4 text-[#0054A6]" /> },
        { href: "/intelligence/almacenamiento/azure-data-lake-storage-gen2-finops-cmp", label: t("tabDataLakeFinopsCmp"), icon: <Database className="w-4 h-4 text-[#0054A6]" /> },
    ];

    return (
        <div className={inter.className}>
            <div className="px-6 pt-4">
                <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                    <IconDatabase className="w-6 h-6 text-[#0054A6]" />
                    {t("title")}
                </h1>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{t("subtitle")}</p>
            </div>
            <RouteTabsNav tabs={tabs} className="px-6 mt-4 mb-4" />
            {children}
        </div>
    );
}
