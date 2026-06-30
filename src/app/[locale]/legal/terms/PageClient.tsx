'use client';

import { LEGAL_VERSIONS } from '@/lib/legalVersions';
import Link from 'next/link';

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <div className="bg-gradient-to-r from-brand-deep/10 to-brand-bright/10 border-b border-line py-8">
        <div className="max-w-4xl mx-auto px-6">
          <h1 className="text-4xl font-bold text-ink mb-2">Terms of Service</h1>
          <p className="text-gray-600">
            Last updated: {new Date(LEGAL_VERSIONS.terms).toLocaleDateString()}
          </p>
          <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-900">
            <strong>[LEGAL REVIEW PENDING]</strong> Placeholder content for legal review. Not binding until approved.
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-12 space-y-8">
        <section className="space-y-4">
          <h2 className="text-2xl font-bold text-ink">1. Acceptance of Terms</h2>
          <p className="text-gray-700">
            By accessing and using the CSCloud Solutions FinOps platform ("Service"), you accept and agree to be bound by these Terms of Service. If you do not agree to these terms, you must not use the Service.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-bold text-ink">2. Service Description</h2>
          <p className="text-gray-700">
            The Service provides automated Azure cost optimization, governance, and FinOps analysis. Features vary by subscription tier (Essential, Professional, Business, Enterprise).
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-bold text-ink">3. Acceptable Use</h2>
          <p className="text-gray-700">You agree not to:</p>
          <ul className="list-disc list-inside space-y-2 text-gray-700">
            <li>Use the Service for illegal purposes or to violate any laws</li>
            <li>Attempt to gain unauthorized access to the Service or its systems</li>
            <li>Reverse engineer, decompile, or disassemble the platform</li>
            <li>Transmit viruses, malware, or harmful code</li>
            <li>Harass, abuse, or harm others via the Service</li>
            <li>Resell access to the Service without authorization</li>
          </ul>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-bold text-ink">4. Intellectual Property</h2>
          <p className="text-gray-700">
            All content, features, and functionality of the Service are the exclusive property of CSCloud Solutions, its licensors, or other providers. You retain ownership of your data (Azure costs, configuration, etc.). We retain a license to use your data as necessary to provide the Service.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-bold text-ink">5. Warranties & Disclaimers</h2>
          <p className="text-gray-700">
            The Service is provided "AS-IS" without warranties of any kind, express or implied. We do not guarantee that:
          </p>
          <ul className="list-disc list-inside space-y-2 text-gray-700">
            <li>The Service will be uninterrupted or error-free</li>
            <li>Any defects will be corrected</li>
            <li>Cost savings estimates will be achieved</li>
            <li>The Service will meet your specific requirements</li>
          </ul>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-bold text-ink">6. Limitation of Liability</h2>
          <p className="text-gray-700">
            To the maximum extent permitted by law, CSCloud Solutions shall not be liable for indirect, incidental, special, or consequential damages arising from your use of the Service, even if advised of the possibility of such damages.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-bold text-ink">7. Indemnification</h2>
          <p className="text-gray-700">
            You agree to indemnify, defend, and hold harmless CSCloud Solutions from any claims, damages, or costs (including legal fees) arising from your violation of these terms or misuse of the Service.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-bold text-ink">8. Trial & Paid Subscriptions</h2>
          <p className="text-gray-700">
            Free trials are subject to stated trial limits. After trial expiration, you must upgrade to a paid plan to continue. Paid plans renew automatically on the billing cycle unless cancelled. Refunds are not available for partial months except as required by law.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-bold text-ink">9. Termination</h2>
          <p className="text-gray-700">
            CSCloud Solutions may terminate your account immediately if you violate these terms or law. Upon termination, your access is revoked, and unpaid fees become due.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-bold text-ink">10. Governing Law & Jurisdiction</h2>
          <p className="text-gray-700">
            These Terms are governed by the laws of Argentina (Buenos Aires jurisdiction). Any disputes shall be resolved in the courts of Buenos Aires, Argentina.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-bold text-ink">11. Data Processing</h2>
          <p className="text-gray-700">
            For GDPR compliance, a Data Processing Agreement (DPA) is available. Enterprise customers are required to sign the DPA before accessing the Service. See <Link href="/legal/dpa" className="text-brand-deep hover:underline">our DPA</Link> for details.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-bold text-ink">12. Changes to Terms</h2>
          <p className="text-gray-700">
            We may update these terms at any time. Continued use of the Service after changes constitutes your acceptance. We will notify you of material changes via email.
          </p>
        </section>

        <div className="mt-8 p-4 bg-gray-50 rounded-lg border border-line">
          <p className="text-sm text-gray-700">
            Last updated: {new Date(LEGAL_VERSIONS.terms).toLocaleDateString()} | 
            <Link href="/legal/privacy" className="text-brand-deep hover:underline ml-2">Privacy Policy</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
