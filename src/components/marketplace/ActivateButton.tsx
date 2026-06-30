'use client';

import { useState } from 'react';

export default function ActivateButton({
  endpoint,
  payload,
  label,
  color,
}: {
  endpoint: string;
  payload: Record<string, unknown>;
  label: string;
  color: 'blue' | 'orange';
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const colorClass =
    color === 'blue'
      ? 'bg-blue-600 hover:bg-blue-700'
      : 'bg-orange-600 hover:bg-orange-700';

  async function onClick() {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data.error || `Activation failed (${resp.status})`);
      }
      if (data.redirectUrl) {
        window.location.href = data.redirectUrl;
      } else {
        window.location.href = '/signup';
      }
    } catch (err) {
      setError((err as Error).message);
      setLoading(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={onClick}
        disabled={loading}
        className={`w-full px-6 py-3 ${colorClass} disabled:opacity-60 text-white text-lg font-semibold rounded-lg transition-colors`}
      >
        {loading ? 'Activating…' : label}
      </button>
      {error && (
        <p className="mt-3 text-sm text-red-600" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
