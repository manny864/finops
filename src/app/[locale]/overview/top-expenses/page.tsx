import TopExpensesBoard from "@/components/dashboard/TopExpensesBoard";
import MockBanner from "@/components/MockBanner";

export default function TopExpensesPage() {
    return (
        <div className="p-6 max-w-[1320px] mx-auto flex flex-col gap-5">
            <MockBanner />
            <TopExpensesBoard />
        </div>
    );
}
