import CostGroupsBoard from "@/components/dashboard/CostGroupsBoard";
import MockBanner from "@/components/MockBanner";
import { Layers } from "lucide-react";

export default function CostGroupsPage() {
    return (
        <div className="content animate-in fade-in p-6 max-w-[1400px] mx-auto flex flex-col gap-5">
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
