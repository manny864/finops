import MockBanner from "@/components/MockBanner";
import CosmosDbFinopsBoard from "@/components/dashboard/CosmosDbFinopsBoard";

export default async function CosmosDatabasesPage() {
    return (
        <div className="content animate-in fade-in px-6 py-6">
            <MockBanner />
            <CosmosDbFinopsBoard />
        </div>
    );
}

