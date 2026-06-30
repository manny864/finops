'use client';

import { LEGAL_VERSIONS } from '@/lib/legalVersions';
import Link from 'next/link';
import { Shield, Lock, Eye, Server, AlertCircle, CheckCircle } from 'lucide-react';

export default function SecurityPage() {
  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <div className="bg-gradient-to-r from-brand-deep to-brand-bright text-white py-12">
        <div className="max-w-6xl mx-auto px-6">
          <div className="flex items-center gap-4 mb-6">
            <Shield className="w-12 h-12" />
            <h1 className="text-4xl font-bold">Trust Center</h1>
          </div>
          <p className="text-lg opacity-90">Our security posture and compliance commitment</p>
        </div>
      </div>

      {/* Compliance Badges */}
      <div className="bg-gray-50 border-b border-line py-8">
        <div className="max-w-6xl mx-auto px-6">
          <h2 className="text-xl font-bold text-ink mb-6">Compliance Status</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            <div className="bg-white p-4 rounded-lg border border-line text-center">
              <div className="text-3xl mb-2">✓</div>
              <p className="font-semibold text-sm text-ink">GDPR Compliant</p>
              <p className="text-xs text-gray-600 mt-1">Data privacy</p>
            </div>
            <div className="bg-white p-4 rounded-lg border border-yellow-200 text-center">
              <div className="text-3xl mb-2">⏳</div>
              <p className="font-semibold text-sm text-ink">SOC 2 Type II</p>
              <p className="text-xs text-yellow-700 font-medium">Target Q4 2026</p>
            </div>
            <div className="bg-white p-4 rounded-lg border border-line text-center">
              <div className="text-3xl mb-2">☁️</div>
              <p className="font-semibold text-sm text-ink">Azure Certified</p>
              <p className="text-xs text-gray-600 mt-1">Infrastructure</p>
            </div>
            <div className="bg-white p-4 rounded-lg border border-line text-center">
              <div className="text-3xl mb-2">📋</div>
              <p className="font-semibold text-sm text-ink">ISO 27001</p>
              <p className="text-xs text-gray-600 mt-1">Planned 2026</p>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-6xl mx-auto px-6 py-12 space-y-12">
        <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-900">
          <strong>[LEGAL REVIEW PENDING]</strong> Placeholder content for legal review. Not binding until approved.
        </div>

        {/* Encryption */}
        <section className="space-y-4">
          <div className="flex items-center gap-3 mb-6">
            <Lock className="w-6 h-6 text-brand-deep" />
            <h2 className="text-2xl font-bold text-ink">Encryption</h2>
          </div>
          <div className="grid md:grid-cols-2 gap-6">
            <div className="bg-surface/50 p-6 rounded-lg border border-line">
              <h3 className="font-semibold text-ink mb-3">In Transit</h3>
              <p className="text-gray-700">All data in transit is encrypted using TLS 1.2 or higher. HTTP connections are automatically redirected to HTTPS.</p>
            </div>
            <div className="bg-surface/50 p-6 rounded-lg border border-line">
              <h3 className="font-semibold text-ink mb-3">At Rest</h3>
              <p className="text-gray-700">Database records and backups are encrypted with AES-256. Encryption keys are managed separately using Azure Key Vault.</p>
            </div>
          </div>
        </section>

        {/* Access Control */}
        <section className="space-y-4">
          <div className="flex items-center gap-3 mb-6">
            <Eye className="w-6 h-6 text-brand-deep" />
            <h2 className="text-2xl font-bold text-ink">Access Control</h2>
          </div>
          <div className="space-y-3 text-gray-700">
            <p><strong>Authentication:</strong> Multi-factor authentication (MFA) via Microsoft Entra ID (Azure AD)</p>
            <p><strong>Authorization:</strong> Role-based access control (RBAC) enforced at application and database layers</p>
            <p><strong>SSO:</strong> SAML 2.0 single sign-on available for Enterprise customers via WorkOS</p>
            <p><strong>Session Management:</strong> Sessions expire after 24 hours of inactivity; forced re-authentication for sensitive operations</p>
          </div>
        </section>

        {/* Infrastructure */}
        <section className="space-y-4">
          <div className="flex items-center gap-3 mb-6">
            <Server className="w-6 h-6 text-brand-deep" />
            <h2 className="text-2xl font-bold text-ink">Infrastructure & Availability</h2>
          </div>
          <div className="space-y-4 text-gray-700">
            <p>
              <strong>Primary Cloud Provider:</strong> Microsoft Azure (certified for HIPAA, FedRAMP, SOC 2)
            </p>
            <p>
              <strong>Database:</strong> MySQL hosted in configurable Azure regions with automatic daily backups
            </p>
            <p>
              <strong>Disaster Recovery:</strong> Geo-redundant backups; RTO &lt; 4 hours, RPO &lt; 1 hour
            </p>
            <p>
              <strong>SLA:</strong> 99.9% uptime SLA for paid plans (excludes scheduled maintenance)
            </p>
          </div>
        </section>

        {/* Audit & Monitoring */}
        <section className="space-y-4">
          <div className="flex items-center gap-3 mb-6">
            <AlertCircle className="w-6 h-6 text-brand-deep" />
            <h2 className="text-2xl font-bold text-ink">Audit & Monitoring</h2>
          </div>
          <div className="space-y-4 text-gray-700">
            <p>
              <strong>Audit Logs:</strong> All user actions, API calls, and data access are logged and retained for 7 years
            </p>
            <p>
              <strong>Monitoring:</strong> Real-time security monitoring using Azure Security Center; alerts for suspicious activity
            </p>
            <p>
              <strong>Intrusion Detection:</strong> Network intrusion detection and prevention enabled on all endpoints
            </p>
            <p>
              <strong>Penetration Testing:</strong> Annual third-party penetration tests; last completed [DATE PENDING]
            </p>
          </div>
        </section>

        {/* Subprocessors */}
        <section className="space-y-4">
          <h2 className="text-2xl font-bold text-ink">Subprocessors</h2>
          <p className="text-gray-700 mb-4">
            We partner with industry-leading providers for specific services:
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
                  <td className="p-3">Compute, Storage, Networking</td>
                  <td className="p-3">US, EU, LATAM</td>
                </tr>
                <tr className="border-b border-line hover:bg-gray-50">
                  <td className="p-3">Paddle</td>
                  <td className="p-3">Payment Processing</td>
                  <td className="p-3">US/UK</td>
                </tr>
                <tr className="border-b border-line hover:bg-gray-50">
                  <td className="p-3">WorkOS</td>
                  <td className="p-3">Authentication & SSO</td>
                  <td className="p-3">US</td>
                </tr>
                <tr className="border-b border-line hover:bg-gray-50">
                  <td className="p-3">Google Gemini AI</td>
                  <td className="p-3">Optional LLM Services</td>
                  <td className="p-3">US</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-sm text-gray-600 mt-4">
            Full details: <Link href="/legal/subprocessors" className="text-brand-deep hover:underline">Subprocessors List</Link>
          </p>
        </section>

        {/* Incident Response */}
        <section className="space-y-4">
          <h2 className="text-2xl font-bold text-ink">Incident Response</h2>
          <div className="space-y-3 text-gray-700">
            <p>
              <strong>Response Time:</strong> Security incidents are investigated within 2 hours of detection
            </p>
            <p>
              <strong>Notification:</strong> Affected customers are notified within 72 hours of confirmed data breach (per GDPR Art. 33–34)
            </p>
            <p>
              <strong>Status Page:</strong> Real-time incident status available at <a href="/status" className="text-brand-deep hover:underline">status.cscloudsolutions.com.ar</a>
            </p>
          </div>
        </section>

        {/* Download Documents */}
        <section className="space-y-4 bg-gray-50 p-8 rounded-lg border border-line">
          <h2 className="text-2xl font-bold text-ink mb-6">Download Documents</h2>
          <div className="grid md:grid-cols-2 gap-6">
            <a href="#" className="flex items-center gap-4 p-4 bg-white rounded-lg border border-line hover:border-brand-deep transition-colors">
              <CheckCircle className="w-6 h-6 text-brand-deep flex-shrink-0" />
              <div>
                <p className="font-semibold text-ink">DPA (GDPR Art. 28)</p>
                <p className="text-xs text-gray-600">PDF, ~50 KB</p>
              </div>
            </a>
            <a href="#" className="flex items-center gap-4 p-4 bg-white rounded-lg border border-line hover:border-brand-deep transition-colors">
              <CheckCircle className="w-6 h-6 text-brand-deep flex-shrink-0" />
              <div>
                <p className="font-semibold text-ink">Security Whitepaper</p>
                <p className="text-xs text-gray-600">PDF, ~200 KB</p>
              </div>
            </a>
            <a href="#" className="flex items-center gap-4 p-4 bg-white rounded-lg border border-line hover:border-brand-deep transition-colors">
              <CheckCircle className="w-6 h-6 text-brand-deep flex-shrink-0" />
              <div>
                <p className="font-semibold text-ink">SOC 2 Report</p>
                <p className="text-xs text-gray-600">Enterprise customers only (NDA)</p>
              </div>
            </a>
            <a href="/legal/subprocessors" className="flex items-center gap-4 p-4 bg-white rounded-lg border border-line hover:border-brand-deep transition-colors">
              <CheckCircle className="w-6 h-6 text-brand-deep flex-shrink-0" />
              <div>
                <p className="font-semibold text-ink">Subprocessor List</p>
                <p className="text-xs text-gray-600">Always up-to-date</p>
              </div>
            </a>
          </div>
        </section>

        {/* FAQ */}
        <section className="space-y-6">
          <h2 className="text-2xl font-bold text-ink">Frequently Asked Questions</h2>
          <div className="space-y-4">
            <details className="bg-gray-50 p-4 rounded-lg cursor-pointer group">
              <summary className="font-semibold text-ink group-open:text-brand-deep">Is CSCloud SOC 2 certified?</summary>
              <p className="text-gray-700 mt-3">We are targeting SOC 2 Type II certification by Q4 2026. Contact us for our current audit status.</p>
            </details>
            <details className="bg-gray-50 p-4 rounded-lg cursor-pointer group">
              <summary className="font-semibold text-ink group-open:text-brand-deep">Where is my data stored?</summary>
              <p className="text-gray-700 mt-3">Data is stored in Microsoft Azure, in regions you select during onboarding (US, EU, or LATAM options available).</p>
            </details>
            <details className="bg-gray-50 p-4 rounded-lg cursor-pointer group">
              <summary className="font-semibold text-ink group-open:text-brand-deep">Do you perform penetration testing?</summary>
              <p className="text-gray-700 mt-3">Yes, we conduct annual third-party penetration tests. Results are available to Enterprise customers under NDA.</p>
            </details>
            <details className="bg-gray-50 p-4 rounded-lg cursor-pointer group">
              <summary className="font-semibold text-ink group-open:text-brand-deep">How long do you retain audit logs?</summary>
              <p className="text-gray-700 mt-3">We retain audit logs for 7 years to comply with SOC 2 and regulatory requirements.</p>
            </details>
          </div>
        </section>
      </div>
    </div>
  );
}
