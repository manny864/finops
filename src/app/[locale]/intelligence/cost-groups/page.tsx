import CostGroupsBoard from "@/components/dashboard/CostGroupsBoard";
import MockBanner from "@/components/MockBanner";

export default function CostGroupsPage() {
    return (
        <div className="p-6 max-w-[1400px] mx-auto flex flex-col gap-5">
            <MockBanner />
            <CostGroupsBoard />
        </div>
    );
}
