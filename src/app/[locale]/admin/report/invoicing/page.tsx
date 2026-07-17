import React from "react";
import { getTranslations } from "next-intl/server";
import MockBanner from '@/components/MockBanner';
import InvoicingReportPanel from "@/components/dashboard/InvoicingReportPanel";

export default async function InvoicingReportPage() {
    const t = await getTranslations("Navigation");

    return (
        <div className="content animate-in fade-in">
            <MockBanner />
            <div className="vhead">
                <div>
                    <div className="vt">
                        <span className="vico bg-gradient-to-br from-[#0054A6] to-[#00AEEF]">🧾</span>
                        Invoicing Report
                    </div>
                    <div className="vs">Reporte de facturación con markup para clientes PBI (Business+)</div>
                </div>
            </div>

            <div className="p-6 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl shadow-sm mt-6">
                <InvoicingReportPanel />
            </div>
        </div>
    );
}
