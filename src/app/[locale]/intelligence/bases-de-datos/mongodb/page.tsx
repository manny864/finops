import MockBanner from "@/components/MockBanner";
import { MongoDBBoard } from "@/components/dashboard/MongoAndRedisBoard";
import { getTranslations } from "next-intl/server";

export default async function MongoDbPage() {
    const t = await getTranslations("DatabasesHub");

    return (
        <div className="content animate-in fade-in px-6 py-8">
            <MockBanner />
            <div className="mb-6">
                <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
                    {t("mongoTitle")}
                </h2>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                    {t("mongoSubtitle")}
                </p>
            </div>
            <MongoDBBoard />
        </div>
    );
}
