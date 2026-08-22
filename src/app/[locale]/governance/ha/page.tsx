import React from "react";
import MockBanner from "@/components/MockBanner";
import HighAvailabilityPanel from "@/components/governance/HighAvailabilityPanel";

export default function HAPage() {
  return (
    <div className="content animate-in fade-in w-full max-w-full">
      <MockBanner />
      <HighAvailabilityPanel />
    </div>
  );
}
