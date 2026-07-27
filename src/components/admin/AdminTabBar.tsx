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
                    className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                        tab.key === activeTab
                            ? "border-blue-600 text-blue-600 dark:text-blue-400"
                            : "border-transparent text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
                    }`}
                >
                    {tab.label}
                </Link>
            ))}
        </div>
    );
}
