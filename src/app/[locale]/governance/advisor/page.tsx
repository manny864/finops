import AdvisorPanel from "@/components/AdvisorPanel";
import MockBanner from "@/components/MockBanner";
import TelemetryDisclaimerBanner from "@/components/TelemetryDisclaimerBanner";

export default function GovernanceAdvisorPage() {
  return (
    <div className="p-6 max-w-[1400px] mx-auto flex flex-col gap-5 w-full">
      <MockBanner />
      <TelemetryDisclaimerBanner compact />
      <AdvisorPanel />
    </div>
  );
}
