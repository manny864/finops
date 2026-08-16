import AdvisorPanel from "@/components/AdvisorPanel";
import MockBanner from "@/components/MockBanner";
import TelemetryDisclaimerBanner from "@/components/TelemetryDisclaimerBanner";

export default function AdvisorPage() {
  return (
    <div className="p-6 max-w-[1320px] mx-auto flex flex-col gap-5">
      <MockBanner />
      <TelemetryDisclaimerBanner compact />
      <AdvisorPanel />
    </div>
  );
}
