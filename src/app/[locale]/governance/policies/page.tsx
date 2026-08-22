import React from "react";
import MockBanner from "@/components/MockBanner";
import AutoBlockPoliciesPanel from "@/components/governance/AutoBlockPoliciesPanel";

export default function PoliciesPage() {
  return (
    <div className="content animate-in fade-in w-full max-w-full">
      <MockBanner />
      <AutoBlockPoliciesPanel />
    </div>
  );
}
