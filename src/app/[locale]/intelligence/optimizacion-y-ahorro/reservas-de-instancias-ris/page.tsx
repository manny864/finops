import React from "react";
import MockBanner from "@/components/MockBanner";
import Commitments from "@/components/dashboard/Commitments";

export default function ReservasInstanciasRisPage() {
    return (
        <div className="content animate-in fade-in">
            <MockBanner />

            <div className="mt-6">
                <Commitments />
            </div>
        </div>
    );
}
