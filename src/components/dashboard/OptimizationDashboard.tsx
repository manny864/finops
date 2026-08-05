"use client";
import React, { useState } from "react";
import { useTranslations } from "next-intl";
import HybridBenefitCard from "@/components/dashboard/HybridBenefitCard";
import Commitments from "@/components/dashboard/Commitments";
import RatesOptimization from "@/components/dashboard/RatesOptimization";

export default function OptimizationDashboard() {
    const t = useTranslations("Optimization");
    const [activeTab, setActiveTab] = useState("rates");

    const tabs = [
        { id: "rates", label: t("tabs.rates"), icon: "💰" },
        { id: "hybrid", label: t("tabs.hybrid"), icon: "🏷️" },
        { id: "commitments", label: t("tabs.commitments"), icon: "🔖" },
        { id: "savingsPlans", label: t("tabs.savingsPlans"), icon: "📊" },
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
                {activeTab === "rates" && <RatesOptimization />}
                {activeTab === "hybrid" && <HybridBenefitCard />}
                {activeTab === "commitments" && <Commitments />}
                {activeTab === "savingsPlans" && (
                    <div className="p-6 bg-blue-50 dark:bg-slate-800 border border-blue-200 dark:border-slate-700 rounded-lg text-center">
                        <p className="text-slate-600 dark:text-slate-300">{t("savingsPlansNote")}</p>
                    </div>
                )}
            </div>
        </div>
    );
}
