import React from 'react';
import PartnerMarkup from '@/components/dashboard/PartnerMarkup';

export default function MarkupPage() {
    return (
        <div className="content animate-in fade-in">
            <div className="vhead">
                <div>
                    <div className="vt">
                        <span className="vico bg-gradient-to-br from-green-600 to-emerald-700">💲</span>
                        Partner Billing Engine (CSP)
                    </div>
                    <div className="vs">Configura los márgenes de rentabilidad que se añadirán de forma invisible al costo final de la nube de tu cliente.</div>
                </div>
            </div>

            <div className="mt-6">
                <PartnerMarkup />
            </div>
        </div>
    );
}
