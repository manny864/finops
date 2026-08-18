import MockBanner from "@/components/MockBanner";
import CosmosDbFinopsBoard from "@/components/dashboard/CosmosDbFinopsBoard";

export default function CosmosDbPage() {
    return (
        <div className="p-6 max-w-7xl mx-auto animate-in fade-in duration-300">
            <MockBanner />
            <CosmosDbFinopsBoard />
        </div>
    );
}

