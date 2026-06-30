'use client';

import { useEffect, useState } from 'react';
import { useTenant } from '@/components/TenantProvider';
import { Shield, FileText, Download, CheckCircle, Clock } from 'lucide-react';
import { LEGAL_VERSIONS } from '@/lib/legalVersions';
import Link from 'next/link';

interface ComplianceStatus {
  documentType: 'dpa' | 'terms' | 'privacy';
  version: string;
  accepted: boolean;
  accepted_at?: string;
}

export default function AdminCompliancePage() {
  const { selectedTenant } = useTenant();
  const [statuses, setStatuses] = useState<ComplianceStatus[]>([
    { documentType: 'dpa', version: LEGAL_VERSIONS.dpa, accepted: false },
    { documentType: 'terms', version: LEGAL_VERSIONS.terms, accepted: false },
    { documentType: 'privacy', version: LEGAL_VERSIONS.privacy, accepted: false },
  ]);
  const [loading, setLoading] = useState(true);
  const [requestingSoc2, setRequestingSoc2] = useState(false);

  useEffect(() => {
    if (!selectedTenant?.id) return;

    const fetchStatuses = async () => {
      try {
        // Fetch acceptance status for each document
        const results = await Promise.all(
          statuses.map(async (status) => {
            try {
              const response = await fetch(
                `/api/legal/sign?tenantId=${selectedTenant.id}&documentType=${status.documentType}`
              );
              const data = await response.json();
              return {
                ...status,
                accepted: data.accepted,
                accepted_at: data.accepted_at,
              };
            } catch (err) {
              console.error(`Error fetching ${status.documentType} status:`, err);
              return status;
            }
          })
        );
        setStatuses(results);
      } finally {
        setLoading(false);
      }
    };

    fetchStatuses();
  }, [selectedTenant?.id]);

  const handleRequestSoc2 = async () => {
    if (!selectedTenant?.id) return;

    setRequestingSoc2(true);
    try {
      const response = await fetch('/api/admin/compliance/request-soc2', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId: selectedTenant.id,
          company_name: selectedTenant.name,
        }),
      });

      if (response.ok) {
        alert('SOC 2 report request submitted. Our team will contact you within 48 hours.');
      } else {
        alert('Failed to submit request. Please try again.');
      }
    } catch (err) {
      console.error('Error requesting SOC 2 report:', err);
      alert('An error occurred. Please try again.');
    } finally {
      setRequestingSoc2(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <Shield className="w-8 h-8 text-brand-deep" />
        <h1 className="text-3xl font-bold text-ink">Legal & Compliance</h1>
      </div>

      {/* Compliance Status Card */}
      <div className="bg-white rounded-lg border border-line p-6 space-y-6">
        <h2 className="text-xl font-bold text-ink">Document Acceptance Status</h2>

        {loading ? (
          <div className="text-center py-8">
            <p className="text-gray-600">Loading compliance status...</p>
          </div>
        ) : (
          <div className="grid gap-4">
            {statuses.map((status) => (
              <div
                key={status.documentType}
                className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border border-line hover:bg-gray-100 transition-colors"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-1">
                    {status.accepted ? (
                      <CheckCircle className="w-5 h-5 text-green-600" />
                    ) : (
                      <Clock className="w-5 h-5 text-yellow-600" />
                    )}
                    <h3 className="font-semibold text-ink capitalize">{status.documentType}</h3>
                  </div>
                  <p className="text-sm text-gray-600">
                    Version {status.version}
                    {status.accepted_at && (
                      <> · Accepted {new Date(status.accepted_at).toLocaleDateString()}</>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {status.accepted && (
                    <span className="text-xs font-semibold text-green-700 bg-green-50 px-2 py-1 rounded">
                      SIGNED
                    </span>
                  )}
                  <Link
                    href={`/legal/${status.documentType}`}
                    className="px-3 py-2 text-sm font-semibold text-brand-deep border border-brand-deep rounded-lg hover:bg-brand-deep/5 transition-colors"
                  >
                    View
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Download Documents */}
      <div className="bg-white rounded-lg border border-line p-6 space-y-4">
        <h2 className="text-xl font-bold text-ink">Download Documents</h2>
        <div className="grid md:grid-cols-2 gap-4">
          <a
            href="#"
            className="flex items-center gap-4 p-4 bg-gray-50 rounded-lg border border-line hover:border-brand-deep transition-colors cursor-default opacity-50"
          >
            <Download className="w-5 h-5 text-gray-400" />
            <div>
              <p className="font-semibold text-ink">DPA Signed Receipt (PDF)</p>
              <p className="text-xs text-gray-600">Coming soon</p>
            </div>
          </a>
          <Link
            href="/admin/audit"
            className="flex items-center gap-4 p-4 bg-gray-50 rounded-lg border border-line hover:border-brand-deep transition-colors"
          >
            <Download className="w-5 h-5 text-brand-deep" />
            <div>
              <p className="font-semibold text-ink">Audit Log Export</p>
              <p className="text-xs text-gray-600">All user actions & access logs</p>
            </div>
          </Link>
          <Link
            href="/legal/subprocessors"
            className="flex items-center gap-4 p-4 bg-gray-50 rounded-lg border border-line hover:border-brand-deep transition-colors"
          >
            <Download className="w-5 h-5 text-brand-deep" />
            <div>
              <p className="font-semibold text-ink">Subprocessor List</p>
              <p className="text-xs text-gray-600">GDPR Art. 28 compliant</p>
            </div>
          </Link>
        </div>
      </div>

      {/* SOC 2 Request */}
      <div className="bg-gradient-to-r from-brand-deep/10 to-brand-bright/10 rounded-lg border border-brand-deep/20 p-6 space-y-4">
        <h2 className="text-xl font-bold text-ink">Request SOC 2 Report</h2>
        <p className="text-gray-700">
          Enterprise customers can request our SOC 2 Type II audit report (in progress, target Q4 2026). 
          Reports are shared under NDA.
        </p>
        <button
          onClick={handleRequestSoc2}
          disabled={requestingSoc2}
          className="px-6 py-2 font-semibold text-white bg-brand-deep rounded-lg hover:brightness-110 disabled:opacity-50 transition-all"
        >
          {requestingSoc2 ? 'Submitting...' : 'Request SOC 2 Report'}
        </button>
      </div>

      {/* Compliance Roadmap */}
      <div className="bg-white rounded-lg border border-line p-6 space-y-4">
        <h2 className="text-xl font-bold text-ink">Compliance Roadmap</h2>
        <div className="space-y-3">
          <div className="flex items-start gap-4">
            <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-ink">GDPR Compliant</p>
              <p className="text-sm text-gray-600">Privacy Policy, DPA, and data subject rights implemented</p>
            </div>
          </div>
          <div className="flex items-start gap-4">
            <Clock className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-ink">SOC 2 Type II</p>
              <p className="text-sm text-gray-600">Target: Q4 2026. Annual audit in progress.</p>
            </div>
          </div>
          <div className="flex items-start gap-4">
            <Clock className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-ink">ISO 27001</p>
              <p className="text-sm text-gray-600">Planned: 2026. Information security management.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
