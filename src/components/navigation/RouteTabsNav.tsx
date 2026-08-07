"use client";

import React from "react";
import { Link } from "@/i18n/routing";
import { usePathname } from "@/i18n/routing";

type RouteTab = {
    href: string;
    label: string;
    icon?: React.ReactNode;
};

export default function RouteTabsNav({
    tabs,
    className = "",
}: {
    tabs: RouteTab[];
    className?: string;
}) {
    const pathname = (usePathname() || "").replace(/\/$/, "");

    return (
        <div className={`flex gap-1 border-b border-gray-200 dark:border-slate-800 overflow-x-auto ${className}`}>
            {tabs.map((tab) => {
                const tabPath = tab.href.replace(/\/$/, "");
                const active = pathname === tabPath;
                return (
                    <Link
                        key={tab.href}
                        href={tab.href}
                        className={`relative px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                            active
                                ? "border-blue-600 text-blue-700 dark:text-blue-300 bg-blue-50/70 dark:bg-blue-500/10"
                                : "border-transparent text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
                        }`}
                        aria-current={active ? "page" : undefined}
                    >
                        <span className="inline-flex items-center gap-2">
                            {tab.icon}
                            {tab.label}
                        </span>
                        {active && (
                            <span className="absolute -bottom-[1px] left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-blue-600 dark:bg-blue-400" />
                        )}
                    </Link>
                );
            })}
        </div>
    );
}
