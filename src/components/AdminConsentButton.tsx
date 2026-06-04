"use client";
import React from 'react';

export default function AdminConsentButton() {
  const handleOnboard = () => {
    const clientId = process.env.NEXT_PUBLIC_CLIENT_ID;
    if (!clientId) {
      alert("NEXT_PUBLIC_CLIENT_ID no está configurado. Revisa tu archivo .env");
      return;
    }
    const redirectUri = encodeURIComponent(window.location.origin);
    const adminConsentUrl = `https://login.microsoftonline.com/common/adminconsent?client_id=${clientId}&redirect_uri=${redirectUri}`;
    window.location.href = adminConsentUrl;
  };

  return (
    <button 
      onClick={handleOnboard}
      className="bg-amber-500 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-amber-600 transition-colors shadow-sm"
    >
      Onboard Tenant
    </button>
  );
}
