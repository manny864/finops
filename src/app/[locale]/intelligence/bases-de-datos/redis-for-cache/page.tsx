import MockBanner from "@/components/MockBanner";
import RedisCacheFinopsBoard from "@/components/dashboard/RedisCacheFinopsBoard";

export default async function RedisForCachePage() {
    return (
        <div className="content animate-in fade-in px-6 py-6">
            <MockBanner />
            <RedisCacheFinopsBoard />
        </div>
    );
}

