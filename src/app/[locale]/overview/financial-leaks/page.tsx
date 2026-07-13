import FinancialLeaksBoard from "@/components/dashboard/FinancialLeaksBoard";
import MockBanner from "@/components/MockBanner";

export default function FinancialLeaksPage() {
    return (
        <div className="content animate-in fade-in duration-500">
            <div className="vhead">
                <div className="title">
                    <h1>Distribución de Fugas Financieras</h1>
                    <p>Desglose completo del gasto desperdiciado por categoría de recurso, con drill-through a los recursos afectados.</p>
                </div>
            </div>
            <div className="mt-6">
                <MockBanner />
                <FinancialLeaksBoard />
            </div>
        </div>
    );
}
