import React from 'react';
import { getTranslations } from 'next-intl/server';
import ZeroCostInventory from '@/components/dashboard/ZeroCostInventory';

export default async function ZeroCostPage() {
    const t = await getTranslations('Navigation'); // Or any other namespace if available

    return (
        <div className="content animate-in fade-in">
            <div className="vhead">
                <div>
                    <div className="vt">
                        <span className="vico bg-gradient-to-br from-[#0054A6] to-[#00AEEF]">📦</span>
                        Inventario de Costo Cero
                    </div>
                    <div className="vs">Recursos sin costo base detectados en tu infraestructura</div>
                </div>
            </div>

            <div className="p-6 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl shadow-sm mt-6">
                <ZeroCostInventory />
            </div>
        </div>
    );
}
