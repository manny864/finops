import MockBanner from "@/components/MockBanner";
import AzureMySqlFinopsBoard from "@/components/dashboard/AzureMySqlFinopsBoard";

export default async function MysqlPage() {
    return (
        <div className="content animate-in fade-in px-6 py-6">
            <MockBanner />
            <AzureMySqlFinopsBoard />
        </div>
    );
}
