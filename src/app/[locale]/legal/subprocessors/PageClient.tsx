'use client';

import Link from 'next/link';

export default function SubprocessorsPage() {
  const subprocessors = [
    {
      name: 'Microsoft Azure',
      purpose: 'Cloud compute, storage, networking, and data processing',
      locations: ['Brazil (Latin America)'],
      dpa: 'yes' as const,
    },
    {
      name: 'MySQL Database Host',
      purpose: 'Relational database hosting and backups',
      locations: ['Brazil (Latin America)'],
      dpa: 'yes' as const,
    },
    {
      name: 'Paddle',
      purpose: 'Payment processing, billing, and subscription management',
      locations: ['United States', 'United Kingdom'],
      dpa: 'yes' as const,
    },
    {
      name: 'WorkOS',
      purpose: 'SAML 2.0 SSO/authentication and identity management',
      locations: ['United States'],
      dpa: 'yes' as const,
    },
    {
      name: 'Google Gemini AI',
      purpose: 'LLM inference for recommendations (optional, Bring-Your-Own-Key supported)',
      locations: ['United States'],
      dpa: 'yes' as const,
    },
    {
      name: 'Microsoft Graph',
      purpose: 'Email and calendar integration for notifications',
      locations: ['United States', 'European Union'],
      dpa: 'yes' as const,
    },
  ];

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <div className="bg-gradient-to-r from-brand-deep/10 to-brand-bright/10 border-b border-line py-8">
        <div className="max-w-6xl mx-auto px-6">
          <h1 className="text-4xl font-bold text-ink mb-2">Subprocessors</h1>
          <p className="text-gray-600">
            CSCloud Solutions uses the following third-party processors to deliver its services
          </p>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-12 space-y-8">
        <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-900">
          <p>
            <strong>Note:</strong> All subprocessors have agreed to data protection terms equivalent to the GDPR. 
            We notify customers of new subprocessors and provide 30 days to object.
          </p>
        </div>

        {/* Data Residency & Regional Subprocessors */}
        <div className="bg-indigo-50 border border-indigo-200 p-6 rounded-lg space-y-4">
          <h2 className="text-xl font-bold text-ink">Data Residency</h2>
          <p className="text-gray-700">
            CSCloud Solutions currently operates a single physical deployment, hosted in Brazil (Latin America). We do not
            yet offer regional data residency selection — all customer data is processed and stored in this single location
            regardless of the customer&apos;s own region.
          </p>
          <div className="text-sm">
            <p className="font-semibold text-ink">🌎 Latin America (Brazil)</p>
            <p className="text-gray-700">Azure Brazil South</p>
          </div>
          <p className="text-xs text-gray-600 pt-2">
            <strong>Planned:</strong> Multi-region data residency (EU/US/LATAM/APAC) is a potential future enhancement,
            not yet scheduled. This page will be updated with a firm timeline once multi-region deployment is planned.
          </p>
        </div>

        {/* Subprocessors Table */}
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-gray-100 border-b-2 border-line">
                <th className="text-left p-4 font-semibold text-ink">Processor</th>
                <th className="text-left p-4 font-semibold text-ink">Purpose</th>
                <th className="text-left p-4 font-semibold text-ink">Locations</th>
                <th className="text-center p-4 font-semibold text-ink">DPA</th>
              </tr>
            </thead>
            <tbody>
              {subprocessors.map((proc, idx) => (
                <tr key={idx} className="border-b border-line hover:bg-gray-50">
                  <td className="p-4 font-semibold text-ink">{proc.name}</td>
                  <td className="p-4 text-gray-700">{proc.purpose}</td>
                  <td className="p-4 text-gray-700">
                    <div className="flex flex-wrap gap-2">
                      {proc.locations.map((loc, i) => (
                        <span key={i} className="px-2 py-1 bg-gray-100 text-sm rounded">
                          {loc}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="p-4 text-center">
                    {proc.dpa === 'yes' && <span className="text-green-600 font-bold">✓</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Detailed Processor Info */}
        <div className="space-y-8">
          <h2 className="text-2xl font-bold text-ink">Processor Details</h2>

          {subprocessors.map((proc, idx) => (
            <div key={idx} className="bg-surface/50 p-6 rounded-lg border border-line space-y-3">
              <h3 className="text-lg font-bold text-ink">{proc.name}</h3>
              <p><strong>Purpose:</strong> {proc.purpose}</p>
              <p><strong>Locations:</strong> {proc.locations.join(', ')}</p>
              <div className="text-sm text-gray-600 space-y-1 pt-2">
                <p>Data Protection: This processor has committed to processing data in compliance with GDPR and equivalent standards.</p>
                {proc.dpa === 'yes' && (
                  <p>DPA Available: Yes. Standard Contractual Clauses included in their data processing agreements.</p>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Change Notification Policy */}
        <div className="bg-blue-50 border border-blue-200 p-6 rounded-lg space-y-4">
          <h2 className="text-xl font-bold text-ink">Subprocessor Change Policy</h2>
          <p className="text-gray-700">
            We may change or add subprocessors at any time. You will be notified in advance via email (at least 30 days prior), and you have the right to:
          </p>
          <ul className="list-disc list-inside space-y-2 text-gray-700">
            <li>Review the new processor's security and privacy practices</li>
            <li>Object to the addition within 30 days</li>
            <li>Terminate your subscription if we add a processor you cannot accept</li>
          </ul>
        </div>

        {/* Contact & Documentation */}
        <div className="grid md:grid-cols-2 gap-6">
          <div className="bg-surface/50 p-6 rounded-lg border border-line space-y-3">
            <h3 className="font-bold text-ink">Questions About Subprocessors?</h3>
            <p className="text-gray-700 text-sm">
              Contact our Data Protection Officer at <a href="mailto:privacy@cscloudsolutions.com.ar" className="text-brand-deep hover:underline">privacy@cscloudsolutions.com.ar</a>
            </p>
          </div>
          <div className="bg-surface/50 p-6 rounded-lg border border-line space-y-3">
            <h3 className="font-bold text-ink">Related Documents</h3>
            <ul className="space-y-2 text-sm">
              <li><Link href="/legal/privacy" className="text-brand-deep hover:underline">Privacy Policy</Link></li>
              <li><Link href="/legal/dpa" className="text-brand-deep hover:underline">Data Processing Agreement</Link></li>
              <li><Link href="/legal/security" className="text-brand-deep hover:underline">Security & Trust Center</Link></li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
