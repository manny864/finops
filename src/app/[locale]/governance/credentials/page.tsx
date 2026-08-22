import React from "react";
import MockBanner from "@/components/MockBanner";
import CredentialsExpiryPanel from "@/components/governance/CredentialsExpiryPanel";

export default function ExpiringCredentialsPage() {
  return (
    <div className="content animate-in fade-in w-full max-w-full">
      <MockBanner />
      <CredentialsExpiryPanel />
    </div>
  );
}
