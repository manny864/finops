import React from "react";
import MockBanner from "@/components/MockBanner";
import GovernanceReportingPanel from "@/components/governance/GovernanceReportingPanel";

export default function GovernanceReportingPage() {
  return (
    <div className="content animate-in fade-in w-full max-w-full">
      <MockBanner />
      <GovernanceReportingPanel />
    </div>
  );
}
