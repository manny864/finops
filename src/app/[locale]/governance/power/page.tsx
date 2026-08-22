import React from "react";
import MockBanner from "@/components/MockBanner";
import VmPowerManagementPanel from "@/components/governance/VmPowerManagementPanel";

export default function PowerPage() {
  return (
    <div className="content animate-in fade-in w-full max-w-full">
      <MockBanner />
      <VmPowerManagementPanel />
    </div>
  );
}
