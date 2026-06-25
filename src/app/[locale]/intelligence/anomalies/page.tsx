import React from 'react';
import AnomalyDashboard from '@/components/dashboard/AnomalyDashboard';
import { ShieldAlert } from 'lucide-react';

export default function AnomaliesPage() {
    return (
        <div className="content animate-in fade-in">
            <div className="vhead mb-6">
                <div>
                    <div className="vt flex items-center gap-2">
                        <span className="vico bg-gradient-to-br from-red-500 to-rose-700 text-white p-2 rounded-xl">
                            <ShieldAlert className="w-5 h-5" />
                        </span>
                        Detección de Anomalías (AI)
                    </div>
                    <div className="vs">Monitoreo 24/7 estadístico (Z-Score) que dispara alertas automáticamente al detectar desviaciones financieras anómalas.</div>
                </div>
            </div>

            <AnomalyDashboard />
        </div>
    );
}
