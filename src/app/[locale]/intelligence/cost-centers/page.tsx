import CostCenterBudgetsBoard from "@/components/dashboard/CostCenterBudgetsBoard";
import MockBanner from "@/components/MockBanner";

export default function CostCentersPage() {
    return (
        <div className="content animate-in fade-in duration-500">
            <div className="vhead">
                <div className="title">
                    <h1>Presupuesto por Centro de Costos</h1>
                    <p>Gasto real agrupado por el tag CostCenter, comparado contra el presupuesto mensual asignado a cada centro.</p>
                </div>
            </div>
            <div className="mt-6">
                <MockBanner />
                <CostCenterBudgetsBoard />
            </div>
        </div>
    );
}
