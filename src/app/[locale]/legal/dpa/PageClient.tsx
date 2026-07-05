'use client';

import { LEGAL_VERSIONS } from '@/lib/legalVersions';
import Link from 'next/link';
import { useState } from 'react';
import { CheckCircle2 } from 'lucide-react';

export default function DPAPage() {
  const [signed, setSigned] = useState(false);
  const [signingUser, setSigningUser] = useState<string | null>(null);

  const handleSign = async () => {
    // In a real implementation, this would call /api/legal/sign
    setSigned(true);
    setSigningUser('John Doe (john@company.com)');
  };

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <div className="bg-gradient-to-r from-brand-deep/10 to-brand-bright/10 border-b border-line py-8">
        <div className="max-w-4xl mx-auto px-6">
          <h1 className="text-4xl font-bold text-ink mb-2">Data Processing Agreement (DPA)</h1>
          <p className="text-gray-600 mb-4">GDPR Article 28 Compliant Data Processing Agreement</p>
          <p className="text-gray-600">
            Last updated: {new Date(LEGAL_VERSIONS.dpa).toLocaleDateString()}
          </p>
          <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-900">
            <strong>[LEGAL REVIEW PENDING]</strong> Placeholder content for legal review. Not binding until approved.
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-12 space-y-8">
        {/* Sign CTA */}
        <div className="bg-brand-deep/5 border-2 border-brand-deep rounded-lg p-6">
          {signed ? (
            <div className="flex items-center gap-3 text-green-700">
              <CheckCircle2 className="w-6 h-6" />
              <div>
                <p className="font-semibold">✓ DPA Signed</p>
                <p className="text-sm">Signed by {signingUser} on {new Date().toLocaleDateString()}</p>
              </div>
            </div>
          ) : (
            <div>
              <p className="text-gray-700 mb-4">Enterprise customers must sign this DPA before accessing the Service.</p>
              <button
                onClick={handleSign}
                className="px-6 py-2 bg-brand-deep text-white rounded-lg hover:brightness-110 transition-all font-semibold"
              >
                Sign DPA
              </button>
            </div>
          )}
        </div>

        <section className="space-y-4">
          <h2 className="text-2xl font-bold text-ink">1. Definitions (Art. 4, GDPR)</h2>
          <div className="space-y-3 text-gray-700">
            <p><strong>Controller:</strong> Your organization, which determines the purposes and means of processing personal data.</p>
            <p><strong>Processor:</strong> CSCloudSolutions, which processes personal data on your behalf.</p>
            <p><strong>Personal Data:</strong> Any information relating to an identified or identifiable natural person.</p>
            <p><strong>Processing:</strong> Any operation performed on personal data (collection, recording, analysis, erasure, etc.).</p>
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-bold text-ink">2. Subject Matter & Duration (Art. 28(3))</h2>
          <div className="space-y-3 text-gray-700">
            <p><strong>Subject Matter:</strong> Processing of Azure cost data and associated metadata.</p>
            <p><strong>Duration:</strong> For the term of your subscription with CSCloudSolutions. Processing ceases upon termination unless required by law.</p>
            <p><strong>Nature:</strong> Storage, analysis, and reporting of customer billing and governance data.</p>
            <p><strong>Purpose:</strong> To deliver FinOps optimization, cost analysis, and governance services.</p>
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-bold text-ink">3. Categories of Data Subjects & Personal Data (Art. 28(3)(a))</h2>
          <div className="space-y-3 text-gray-700">
            <p><strong>Data Subjects:</strong></p>
            <ul className="list-disc list-inside ml-4">
              <li>Your employees with Azure subscriptions</li>
              <li>Resource owners and administrators</li>
              <li>Your end users whose costs are attributed</li>
            </ul>
            <p className="mt-3"><strong>Personal Data Categories:</strong></p>
            <ul className="list-disc list-inside ml-4">
              <li>Email addresses and display names</li>
              <li>Azure AD object IDs (OID)</li>
              <li>Resource tags containing user identifiers</li>
              <li>Usage patterns and cost attribution</li>
            </ul>
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-bold text-ink">4. Subprocessors (Art. 28(2) & (4))</h2>
          <p className="text-gray-700">
            CSCloudSolutions engages the following subprocessors. You are notified of changes and may object within 30 days.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-gray-100 border-b border-line">
                  <th className="text-left p-3 font-semibold">Processor</th>
                  <th className="text-left p-3 font-semibold">Purpose</th>
                  <th className="text-left p-3 font-semibold">Location</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-line hover:bg-gray-50">
                  <td className="p-3">Microsoft Azure</td>
                  <td className="p-3">Compute & Storage</td>
                  <td className="p-3">US, EU, LATAM</td>
                </tr>
                <tr className="border-b border-line hover:bg-gray-50">
                  <td className="p-3">MySQL Provider</td>
                  <td className="p-3">Database Hosting</td>
                  <td className="p-3">Configurable</td>
                </tr>
                <tr className="border-b border-line hover:bg-gray-50">
                  <td className="p-3">Paddle</td>
                  <td className="p-3">Payment Processing</td>
                  <td className="p-3">US/UK</td>
                </tr>
                <tr className="border-b border-line hover:bg-gray-50">
                  <td className="p-3">WorkOS</td>
                  <td className="p-3">Authentication/SSO</td>
                  <td className="p-3">US</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-sm text-gray-600 mt-4">
            Full list: See <Link href="/legal/subprocessors" className="text-brand-deep hover:underline">Subprocessors Page</Link>
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-bold text-ink">5. Data Subject Rights (Art. 28(3)(e))</h2>
          <p className="text-gray-700">
            We assist you in fulfilling data subject requests under GDPR Articles 15–22 (access, rectification, erasure, restriction, portability, objection). Requests should be submitted to <a href="mailto:privacy@cscloudsolutions.com.ar" className="text-brand-deep hover:underline">privacy@cscloudsolutions.com.ar</a> within 10 business days.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-bold text-ink">6. Security Measures (Art. 28(3)(c) & 32)</h2>
          <p className="text-gray-700">CSCloudSolutions implements:</p>
          <ul className="list-disc list-inside space-y-2 text-gray-700">
            <li><strong>Encryption:</strong> TLS 1.2+ in transit; AES-256 at rest</li>
            <li><strong>Access Control:</strong> RBAC, MSAL/Entra ID integration, MFA mandatory</li>
            <li><strong>Monitoring:</strong> Continuous security monitoring and intrusion detection</li>
            <li><strong>Audit Logs:</strong> All access logged and retained for 7 years</li>
            <li><strong>Disaster Recovery:</strong> Geo-redundant backups; RTO &lt; 4 hours</li>
          </ul>
          <p className="text-sm text-gray-600 mt-3">
            See <Link href="/legal/security" className="text-brand-deep hover:underline">Security & Trust Center</Link> for full details.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-bold text-ink">7. Audit Rights (Art. 28(3)(h))</h2>
          <p className="text-gray-700">
            You (or an independent auditor) may conduct audits of CSCloudSolutions' security and compliance practices. Annual SOC 2 Type II audit reports are available upon request for Enterprise customers.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-bold text-ink">8. Return/Deletion of Data (Art. 28(3)(g))</h2>
          <p className="text-gray-700">
            Upon subscription termination, you may request data deletion within 30 days. All data will be permanently deleted using cryptographic erasure. Backups are retained for disaster recovery and deleted after 90 days.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-bold text-ink">Annex 1: Subprocessor Table</h2>
          <p className="text-gray-700">
            See <Link href="/legal/subprocessors" className="text-brand-deep hover:underline">full Subprocessors list</Link>.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-bold text-ink">Annex 2: Technical & Organizational Measures (TOMs)</h2>
          <div className="space-y-3 text-gray-700">
            <p><strong>Technical Measures:</strong> Encryption, firewalls, IDS/IPS, SIEM, secure coding practices</p>
            <p><strong>Organizational Measures:</strong> Access controls, employee training, incident response plan, vendor vetting</p>
            <p className="text-sm">
              Details available in SOC 2 Type II report upon request.
            </p>
          </div>
        </section>

        <div className="mt-8 p-4 bg-gray-50 rounded-lg border border-line">
          <p className="text-sm text-gray-700">
            Last updated: {new Date(LEGAL_VERSIONS.dpa).toLocaleDateString()} | 
            <Link href="/legal/terms" className="text-brand-deep hover:underline ml-2">Terms</Link> | 
            <Link href="/legal/privacy" className="text-brand-deep hover:underline ml-2">Privacy</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
