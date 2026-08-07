"use client";
import Link from "next/link";

export default function AdminTabBar({
    basePath,
    tabs,
    activeTab,
}: {
    basePath: string;
    tabs: { key: string; label: string }[];
    activeTab: string;
}) {
    return (
        <div className="flex gap-1 border-b border-gray-200 dark:border-slate-800 mb-6 overflow-x-auto px-6 pt-4">
            {tabs.map((tab) => (
                <Link
                    key={tab.key}
                    href={`${basePath}?tab=${tab.key}`}
                    className={`relative px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                        tab.key === activeTab
                            ? "border-blue-600 text-blue-700 dark:text-blue-300 bg-blue-50/70 dark:bg-blue-500/10"
                            : "border-transparent text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
                    }`}
                    aria-current={tab.key === activeTab ? "page" : undefined}
                >
                    {tab.label}
                    {tab.key === activeTab && (
                        <span className="absolute -bottom-[1px] left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-blue-600 dark:bg-blue-400" />
                    )}
                </Link>
            ))}
        </div>
    );
}
