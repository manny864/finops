'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { X } from 'lucide-react';

export default function CookieConsent() {
  const [showBanner, setShowBanner] = useState(false);
  const [accepted, setAccepted] = useState(false);

  useEffect(() => {
    // Check if user has already made a choice
    const consent = localStorage.getItem('cookie_consent_v1');
    if (!consent) {
      setShowBanner(true);
    } else {
      setAccepted(true);
    }
  }, []);

  const handleAccept = (acceptAll: boolean) => {
    localStorage.setItem(
      'cookie_consent_v1',
      JSON.stringify({
        acceptAll,
        acceptedAt: new Date().toISOString(),
      })
    );
    setShowBanner(false);
    setAccepted(true);
  };

  if (!showBanner) {
    return null;
  }

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-line shadow-lg">
      <div className="max-w-7xl mx-auto px-6 py-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
          {/* Message */}
          <div className="flex-1">
            <p className="text-sm text-gray-700">
              We use essential cookies for authentication and security. We also use analytics cookies to improve your experience.
              {' '}
              <Link href="/legal/privacy" className="text-brand-deep hover:underline font-semibold">
                Read our Privacy Policy
              </Link>
            </p>
          </div>

          {/* Buttons */}
          <div className="flex items-center gap-3 flex-shrink-0">
            <button
              onClick={() => handleAccept(false)}
              className="px-4 py-2 text-sm font-semibold text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
            >
              Essential Only
            </button>
            <button
              onClick={() => handleAccept(true)}
              className="px-4 py-2 text-sm font-semibold text-white bg-brand-deep rounded-lg hover:brightness-110 transition-all"
            >
              Accept All
            </button>
            <button
              onClick={() => setShowBanner(false)}
              className="p-2 text-gray-500 hover:text-gray-700 transition-colors"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
