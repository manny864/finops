'use client';

import { useState } from "react";
import MockBanner from "@/components/MockBanner";
import { PostgresBoard, MysqlBoard } from "@/components/dashboard/PostgresAndMysqlBoard";

export default function PostgreMySqlPage() {
    const [activeTab, setActiveTab] = useState<"postgres" | "mysql">("postgres");

    return (
        <div className="content animate-in fade-in px-6 py-8">
            <MockBanner />
            <div className="mb-6">
                <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
                    Open Source Databases
                </h2>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                    Azure Database for PostgreSQL and MySQL diagnostics and metrics
                </p>
            </div>

            <div className="flex gap-2 mb-6 border-b border-gray-200">
                <button
                    onClick={() => setActiveTab("postgres")}
                    className={`px-4 py-2 font-medium transition-colors ${
                        activeTab === "postgres"
                            ? "text-blue-600 border-b-2 border-blue-600"
                            : "text-gray-600 hover:text-gray-900"
                    }`}
                >
                    PostgreSQL
                </button>
                <button
                    onClick={() => setActiveTab("mysql")}
                    className={`px-4 py-2 font-medium transition-colors ${
                        activeTab === "mysql"
                            ? "text-orange-600 border-b-2 border-orange-600"
                            : "text-gray-600 hover:text-gray-900"
                    }`}
                >
                    MySQL
                </button>
            </div>

            {activeTab === "postgres" && <PostgresBoard />}
            {activeTab === "mysql" && <MysqlBoard />}
        </div>
    );
}
