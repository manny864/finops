"use client";
import React, { useState } from "react";
import { useTranslations } from "next-intl";
import StorageEfficiencyDashboard from "@/components/dashboard/StorageEfficiencyDashboard";
import ComputeEfficiencyDashboard from "@/components/dashboard/ComputeEfficiencyDashboard";
import AIAnalyticsDashboard from "@/components/dashboard/AIAnalyticsDashboard";

export default function EfficiencyDashboard() {
    const t = useTranslations("Efficiency");
    const [activeTab, setActiveTab] = useState("storage");

    const tabs = [
        { id: "storage", label: t("tabs.storage"), icon: "🗄️" },
        { id: "compute", label: t("tabs.compute"), icon: "⚙️" },
        { id: "ai", label: t("tabs.ai"), icon: "🤖" },
    ];

    return (
        <div className="w-full">
            <div className="flex gap-2 mb-6 border-b border-gray-200 dark:border-slate-700">
                {tabs.map(tab => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={`px-4 py-3 font-medium transition-colors ${
                            activeTab === tab.id
                                ? "border-b-2 border-brand-bright text-brand-bright"
                                : "border-b-2 border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-300"
                        }`}
                    >
                        <span className="mr-2">{tab.icon}</span>
                        {tab.label}
                    </button>
                ))}
            </div>

            <div className="mt-6">
                {activeTab === "storage" && <StorageEfficiencyDashboard />}
                {activeTab === "compute" && <ComputeEfficiencyDashboard />}
                {activeTab === "ai" && <AIAnalyticsDashboard />}
            </div>
        </div>
    );
}
