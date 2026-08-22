import React from "react";
import MockBanner from "@/components/MockBanner";
import RemediationApprovalsPanel from "@/components/governance/RemediationApprovalsPanel";

export default function GovernanceApprovalsPage() {
  return (
    <div className="content animate-in fade-in w-full max-w-full">
      <MockBanner />
      <RemediationApprovalsPanel />
    </div>
  );
}
