import CostGroupsBoard from "@/components/dashboard/CostGroupsBoard";
import MockBanner from "@/components/MockBanner";
import { Layers } from "lucide-react";

export default function CostGroupsPage() {
    // Ancho completo: las tablas de grupos de costos tienen muchas columnas
    // (gasto, presupuesto, variación, recursos, acciones) y el tope de 1400px
    // las comprimía obligando a scroll horizontal en pantallas que tenían lugar
    // de sobra. Era además la única página de intelligence con ese tope: las
    // otras 21 ya van a ancho completo.
    return (
        <div className="content animate-in fade-in p-6 w-full max-w-full flex flex-col gap-5">
            <div className="vhead">
                <div>
                    <div className="vt">
                        <span className="vico">
                            <Layers className="w-5 h-5" />
                        </span>
                        Costos por grupos
                    </div>
                </div>
            </div>
            <MockBanner />
            <CostGroupsBoard />
        </div>
    );
}
