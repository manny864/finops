'use client';

import { useTranslations } from 'next-intl';
import { LEGAL_VERSIONS } from '@/lib/legalVersions';
import { useState } from 'react';
import Link from 'next/link';

type Section = 'data-collection' | 'usage' | 'processors' | 'retention' | 'rights' | 'transfers' | 'contact';

export default function PrivacyPage() {
  const t = useTranslations('Common');
  const [activeSection, setActiveSection] = useState<Section>('data-collection');

  const sections: { id: Section; title: string }[] = [
    { id: 'data-collection', title: 'Data We Collect' },
    { id: 'usage', title: 'How We Use It' },
    { id: 'processors', title: 'Subprocessors' },
    { id: 'retention', title: 'Data Retention' },
    { id: 'rights', title: 'Your Rights' },
    { id: 'transfers', title: 'International Transfers' },
    { id: 'contact', title: 'Contact' },
  ];

  return (
    <div className="min-h-screen bg-white">
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-brand-deep/10 to-brand-bright/10 border-b border-line py-8">
        <div className="max-w-7xl mx-auto px-6">
          <h1 className="text-4xl font-bold text-ink mb-2">Privacy Policy</h1>
          <p className="text-gray-600">
            Last updated: {new Date(LEGAL_VERSIONS.privacy).toLocaleDateString()}
          </p>
          <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-900">
            <strong>[LEGAL REVIEW PENDING]</strong> This is placeholder content for review by legal counsel. Not binding until approved.
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-12 grid grid-cols-1 lg:grid-cols-4 gap-8">
        {/* Sidebar TOC */}
        <div className="lg:col-span-1">
          <div className="sticky top-20 bg-surface/50 rounded-lg p-4 border border-line">
            <h3 className="font-bold text-ink mb-4">Table of Contents</h3>
            <nav className="space-y-2">
              {sections.map((section) => (
                <button
                  key={section.id}
                  onClick={() => setActiveSection(section.id)}
                  className={`w-full text-left px-3 py-2 rounded text-sm transition-colors ${
                    activeSection === section.id
                      ? 'bg-brand-deep text-white font-semibold'
                      : 'text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  {section.title}
                </button>
              ))}
            </nav>
          </div>
        </div>

        {/* Content */}
        <div className="lg:col-span-3 space-y-8">
          {/* Data Collection */}
          {activeSection === 'data-collection' && (
            <section id="data-collection" className="space-y-4">
              <h2 className="text-2xl font-bold text-ink">What Data We Collect</h2>
              <p className="text-gray-700 leading-relaxed">
                To provide the FinOps platform, we collect and process the following types of data:
              </p>
              <ul className="list-disc list-inside space-y-3 text-gray-700">
                <li><strong>Azure cost data:</strong> Your Azure subscription costs, resource usage, and billing information</li>
                <li><strong>User identities:</strong> Email addresses, names, Azure AD object IDs from your directory</li>
                <li><strong>Tenant information:</strong> Tenant ID, company name, subscription tier</li>
                <li><strong>Usage analytics:</strong> How you interact with the platform (features used, timestamps)</li>
                <li><strong>Configuration data:</strong> Your preferences, tags, budgets, and policies</li>
              </ul>
            </section>
          )}

          {/* Usage */}
          {activeSection === 'usage' && (
            <section id="usage" className="space-y-4">
              <h2 className="text-2xl font-bold text-ink">How We Use Your Data</h2>
              <div className="space-y-4">
                <div>
                  <h3 className="font-semibold text-ink mb-2">Service Delivery</h3>
                  <p className="text-gray-700">We process your data to deliver FinOps analysis, cost optimization, and governance features.</p>
                </div>
                <div>
                  <h3 className="font-semibold text-ink mb-2">Platform Improvement</h3>
                  <p className="text-gray-700">Anonymized usage patterns help us improve features and performance.</p>
                </div>
                <div>
                  <h3 className="font-semibold text-ink mb-2">Security & Compliance</h3>
                  <p className="text-gray-700">We log access and actions for audit, fraud detection, and compliance purposes.</p>
                </div>
              </div>
            </section>
          )}

          {/* Processors */}
          {activeSection === 'processors' && (
            <section id="processors" className="space-y-4">
              <h2 className="text-2xl font-bold text-ink">Our Subprocessors</h2>
              <p className="text-gray-700">We engage the following processors to deliver the service:</p>
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
                      <td className="p-3">Compute, storage, data processing</td>
                      <td className="p-3">US, EU, LATAM</td>
                    </tr>
                    <tr className="border-b border-line hover:bg-gray-50">
                      <td className="p-3">MySQL Host</td>
                      <td className="p-3">Database hosting</td>
                      <td className="p-3">Configurable</td>
                    </tr>
                    <tr className="border-b border-line hover:bg-gray-50">
                      <td className="p-3">Paddle</td>
                      <td className="p-3">Payments & billing</td>
                      <td className="p-3">US/UK</td>
                    </tr>
                    <tr className="border-b border-line hover:bg-gray-50">
                      <td className="p-3">WorkOS</td>
                      <td className="p-3">SSO/SAML authentication</td>
                      <td className="p-3">US</td>
                    </tr>
                    <tr className="border-b border-line hover:bg-gray-50">
                      <td className="p-3">Google Gemini AI</td>
                      <td className="p-3">LLM inference (optional, BYO key supported)</td>
                      <td className="p-3">US</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="text-sm text-gray-600 mt-4">
                See <Link href="/legal/subprocessors" className="text-brand-deep hover:underline">full subprocessor list</Link> for more details.
              </p>
            </section>
          )}

          {/* Retention */}
          {activeSection === 'retention' && (
            <section id="retention" className="space-y-4">
              <h2 className="text-2xl font-bold text-ink">Data Retention</h2>
              <div className="space-y-4">
                <div>
                  <h3 className="font-semibold text-ink mb-2">Telemetry & Analytics</h3>
                  <p className="text-gray-700">Deleted after 90 days unless required for compliance.</p>
                </div>
                <div>
                  <h3 className="font-semibold text-ink mb-2">Billing & Cost Data</h3>
                  <p className="text-gray-700">Retained indefinitely for billing accuracy and tax compliance.</p>
                </div>
                <div>
                  <h3 className="font-semibold text-ink mb-2">Audit Logs</h3>
                  <p className="text-gray-700">Retained for 7 years as per SOC 2 requirements.</p>
                </div>
                <div>
                  <h3 className="font-semibold text-ink mb-2">Account Data</h3>
                  <p className="text-gray-700">Retained until account deletion; then anonymized after 30 days.</p>
                </div>
              </div>
            </section>
          )}

          {/* Rights */}
          {activeSection === 'rights' && (
            <section id="rights" className="space-y-4">
              <h2 className="text-2xl font-bold text-ink">Your GDPR Rights</h2>
              <p className="text-gray-700">You have the right to:</p>
              <ul className="list-disc list-inside space-y-2 text-gray-700">
                <li><strong>Access (Art. 15):</strong> Request a copy of your personal data</li>
                <li><strong>Rectification (Art. 16):</strong> Correct inaccurate data</li>
                <li><strong>Erasure (Art. 17):</strong> Delete your data (right to be forgotten)</li>
                <li><strong>Restrict processing (Art. 18):</strong> Limit how we use your data</li>
                <li><strong>Data portability (Art. 20):</strong> Receive your data in a portable format</li>
                <li><strong>Object (Art. 21):</strong> Opt out of processing for legitimate interests</li>
              </ul>
              <p className="text-gray-700 mt-4">
                To exercise these rights, contact <a href="mailto:privacy@cscloudsolutions.com.ar" className="text-brand-deep hover:underline">privacy@cscloudsolutions.com.ar</a> with your request and proof of identity.
              </p>
            </section>
          )}

          {/* International Transfers */}
          {activeSection === 'transfers' && (
            <section id="transfers" className="space-y-4">
              <h2 className="text-2xl font-bold text-ink">International Data Transfers</h2>
              <p className="text-gray-700">
                Our infrastructure spans multiple regions (US, EU, LATAM). We rely on Standard Contractual Clauses (SCCs) and adequacy decisions to ensure lawful transfers under GDPR.
              </p>
              <p className="text-gray-700">
                If you are located in the EU and your data is transferred to the US, we provide binding commitments through SCCs and supplementary measures to ensure equivalent protection.
              </p>
            </section>
          )}

          {/* Contact */}
          {activeSection === 'contact' && (
            <section id="contact" className="space-y-4">
              <h2 className="text-2xl font-bold text-ink">Contact Us</h2>
              <div className="space-y-3 text-gray-700">
                <p>
                  <strong>Privacy Officer:</strong><br />
                  privacy@cscloudsolutions.com.ar
                </p>
                <p>
                  <strong>Company:</strong><br />
                  CSCloud Solutions<br />
                  Buenos Aires, Argentina
                </p>
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
