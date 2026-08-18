import { ReactNode } from "react";
import { Inter } from "next/font/google";
import { getTranslations } from "next-intl/server";
import RouteTabsNav from "@/components/navigation/RouteTabsNav";
import { IconDatabase, IconDisc, IconShieldCheck, IconFolders } from "@tabler/icons-react";
import InfoTooltip from "@/components/InfoTooltip";

const inter = Inter({ subsets: ["latin"] });

export default async function AlmacenamientoLayout({ children }: { children: ReactNode }) {
    const t = await getTranslations("StorageHub");

    const tabs = [
        {
            href: "/intelligence/almacenamiento/storage-accounts-finops-cmp",
            label: t("tabStorageAccountsFinopsCmp"),
            icon: <IconDatabase className="w-4 h-4 text-[#0054A6]" stroke={1.5} />,
            tooltip: t("tooltip_tab_storage_accounts"),
        },
        {
            href: "/intelligence/almacenamiento/mdisk",
            label: t("tabManagedDiskFinopsCmp"),
            icon: <IconDisc className="w-4 h-4 text-[#0054A6]" stroke={1.5} />,
            tooltip: t("tooltip_tab_managed_disk"),
        },
        {
            href: "/intelligence/almacenamiento/backups-finops-cmp",
            label: t("tabBackupsFinopsCmp"),
            icon: <IconShieldCheck className="w-4 h-4 text-[#0054A6]" stroke={1.5} />,
            tooltip: t("tooltip_tab_backups"),
        },
        {
            href: "/intelligence/almacenamiento/adls2",
            label: t("tabDataLakeFinopsCmp"),
            icon: <IconFolders className="w-4 h-4 text-[#0054A6]" stroke={1.5} />,
            tooltip: t("tooltip_tab_datalake"),
        },
    ];

    return (
        <div className={inter.className}>
            <div className="px-6 pt-4">
                <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                    <IconDatabase className="w-6 h-6 text-[#0054A6]" stroke={1.5} />
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
