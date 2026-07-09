import React from "react";
import MockBanner from '@/components/MockBanner';
import TenantHealthDashboard from "@/components/dashboard/TenantHealthDashboard";
import { HeartPulse } from "lucide-react";

export default function TenantHealthPage() {
    return (
        <div className="content animate-in fade-in">
            <MockBanner />
            <div className="vhead">
                <div>
                    <div className="vt flex items-center gap-2">
                        <span className="vico bg-gradient-to-br from-rose-500 to-pink-700 text-white p-2 rounded-xl">
                            <HeartPulse className="w-5 h-5" />
                        </span>
                        Dashboard de Salud del Tenant
                    </div>
                    <div className="vs">Score compuesto que combina presupuesto, credenciales por expirar, optimización de recomendaciones y postura de seguridad en un solo número accionable.</div>
                </div>
            </div>

            <TenantHealthDashboard />
        </div>
    );
}
