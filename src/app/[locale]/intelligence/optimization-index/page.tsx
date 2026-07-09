import React from "react";
import MockBanner from '@/components/MockBanner';
import CoinDashboard from "@/components/dashboard/CoinDashboard";
import { Target } from "lucide-react";

export default function OptimizationIndexPage() {
    return (
        <div className="content animate-in fade-in">
            <MockBanner />
            <div className="vhead">
                <div>
                    <div className="vt flex items-center gap-2">
                        <span className="vico bg-gradient-to-br from-sky-500 to-blue-700 text-white p-2 rounded-xl">
                            <Target className="w-5 h-5" />
                        </span>
                        Índice de Optimización (COIN)
                    </div>
                    <div className="vs">Qué porcentaje de las recomendaciones de ahorro y eficiencia detectadas realmente terminás implementando — tu tasa de ejecución FinOps.</div>
                </div>
            </div>

            <CoinDashboard />
        </div>
    );
}
