import React from "react";
import MockBanner from "@/components/MockBanner";
import PerspectivesBoard from "@/components/dashboard/PerspectivesBoard";

export default function PerspectivesPage() {
    return (
        <div className="w-full max-w-full py-2 animate-in fade-in">
            <MockBanner />
            <PerspectivesBoard />
        </div>
    );
}
