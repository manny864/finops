import M365UsersBoard from "@/components/dashboard/M365UsersBoard";
import MockBanner from "@/components/MockBanner";

export default function UsersLicensesPage() {
    return (
        <div className="p-6 max-w-[1320px] mx-auto flex flex-col gap-5">
            <MockBanner />
            <M365UsersBoard />
        </div>
    );
}
