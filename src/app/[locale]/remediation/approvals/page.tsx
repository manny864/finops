import React from 'react';
import RemediationApprovals from '@/components/dashboard/RemediationApprovals';

export default function ApprovalsPage() {
    return (
        <div className="content animate-in fade-in">
            <div className="vhead">
                <div>
                    <div className="vt">
                        <span className="vico bg-gradient-to-br from-[#F59E0B] to-[#D97706]">🛡️</span>
                        Aprobaciones de Remediación
                    </div>
                    <div className="vs">Flujo de autorización para la aplicación segura de cambios destructivos o de redimensionamiento (Rightsizing & Cleanup).</div>
                </div>
            </div>

            <div className="mt-6">
                <RemediationApprovals />
            </div>
        </div>
    );
}
