import MockBanner from "@/components/MockBanner";
import RedisTestBoard from "@/components/dashboard/RedisTestBoard";

export default async function RedisTestPage() {
    return (
        <div className="content animate-in fade-in py-4">
            <MockBanner />
            <RedisTestBoard />
        </div>
    );
}
