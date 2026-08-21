import ResourcesBoard from "@/components/dashboard/ResourcesBoard";
import MockBanner from "@/components/MockBanner";

export default function ResourcesPage() {
    return (
        <div className="p-6 w-full flex flex-col gap-5">
            <MockBanner />
            <ResourcesBoard />
        </div>
    );
}
