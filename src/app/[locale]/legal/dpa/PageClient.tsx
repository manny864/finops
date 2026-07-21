'use client';

import { useTranslations } from 'next-intl';
import { LEGAL_VERSIONS } from '@/lib/legalVersions';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { useMsal } from '@azure/msal-react';
import { useTenant } from '@/components/TenantProvider';
import { getFreshIdToken } from '@/lib/msalToken';
import { toast } from 'sonner';

function formatSigner(email: string | null, name: string | null): string {
  if (!email) return '';
  return name ? `${name} (${email})` : email;
}

export default function DPAPage() {
  const t = useTranslations('LegalDpa');
  const { instance, accounts } = useMsal();
  const { selectedTenant } = useTenant();
  const [signed, setSigned] = useState(false);
  const [signingUser, setSigningUser] = useState<string | null>(null);
  const [signedAt, setSignedAt] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);

  const account = accounts[0];
  const tenantId = selectedTenant && selectedTenant.id !== 'default' ? selectedTenant.id : null;

  const authHeaders = useCallback(async (): Promise<Record<string, string>> => {
    if (!account) return {};
    const token = await getFreshIdToken(instance, account);
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, [instance, account]);

  useEffect(() => {
    if (!account || !tenantId) return;
    let cancelled = false;
    (async () => {
      try {
        const headers = await authHeaders();
        const res = await fetch(`/api/legal/sign?tenantId=${tenantId}&documentType=dpa`, { headers });
        const json = await res.json();
        if (!cancelled && res.ok && json.accepted) {
          setSigned(true);
          setSigningUser(formatSigner(json.signedByEmail, json.signedByName));
          setSignedAt(json.accepted_at);
        }
      } catch {
        // Sin firma previa o sin acceso: se deja el estado "no firmado".
      }
    })();
    return () => { cancelled = true; };
  }, [account, tenantId, authHeaders]);

  const handleSign = async () => {
    if (!account || !tenantId) {
      toast.error(t('signRequiresLogin'));
      return;
    }
    setSigning(true);
    try {
      const headers = await authHeaders();
      const res = await fetch(`/api/legal/sign?tenantId=${tenantId}`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentType: 'dpa' }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setSigned(true);
      setSigningUser(formatSigner(json.signedByEmail, json.signedByName));
      setSignedAt(json.accepted_at);
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : t('signError'));
    } finally {
      setSigning(false);
    }
  };

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <div className="bg-gradient-to-r from-brand-deep/10 to-brand-bright/10 border-b border-line py-8">
        <div className="max-w-4xl mx-auto px-6">
          <h1 className="text-4xl font-bold text-ink mb-2">{t('title')}</h1>
          <p className="text-gray-600 mb-4">{t('subtitle')}</p>
          <p className="text-gray-600">
            {t('lastUpdated', { date: new Date(LEGAL_VERSIONS.dpa).toLocaleDateString() })}
          </p>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-12 space-y-8">
        {/* Sign CTA */}
        <div className="bg-brand-deep/5 border-2 border-brand-deep rounded-lg p-6">
          {signed ? (
            <div className="flex items-center gap-3 text-green-700">
              <CheckCircle2 className="w-6 h-6" />
              <div>
                <p className="font-semibold">{t('signedTitle')}</p>
                <p className="text-sm">
                  {t('signedBy', {
                    user: signingUser ?? '',
                    date: signedAt ? new Date(signedAt).toLocaleDateString() : new Date().toLocaleDateString(),
                  })}
                </p>
              </div>
            </div>
          ) : (
            <div>
              <p className="text-gray-700 mb-4">{t('unsignedIntro')}</p>
              <button
                onClick={handleSign}
                disabled={signing}
                className="px-6 py-2 bg-brand-deep text-white rounded-lg hover:brightness-110 transition-all font-semibold disabled:opacity-50 inline-flex items-center gap-2"
              >
                {signing && <Loader2 className="w-4 h-4 animate-spin" />}
                {t('signButton')}
              </button>
            </div>
          )}
        </div>

        <section className="space-y-4">
          <h2 className="text-2xl font-bold text-ink">{t('s1Title')}</h2>
          <div className="space-y-3 text-gray-700">
            <p>{t('s1Controller')}</p>
            <p>{t('s1Processor')}</p>
            <p>{t('s1PersonalData')}</p>
            <p>{t('s1Processing')}</p>
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-bold text-ink">{t('s2Title')}</h2>
          <div className="space-y-3 text-gray-700">
            <p>{t('s2SubjectMatter')}</p>
            <p>{t('s2Duration')}</p>
            <p>{t('s2Nature')}</p>
            <p>{t('s2Purpose')}</p>
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-bold text-ink">{t('s3Title')}</h2>
          <div className="space-y-3 text-gray-700">
            <p><strong>{t('s3SubjectsLabel')}</strong></p>
            <ul className="list-disc list-inside ml-4">
              <li>{t('s3Subject1')}</li>
              <li>{t('s3Subject2')}</li>
              <li>{t('s3Subject3')}</li>
            </ul>
            <p className="mt-3"><strong>{t('s3CategoriesLabel')}</strong></p>
            <ul className="list-disc list-inside ml-4">
              <li>{t('s3Category1')}</li>
              <li>{t('s3Category2')}</li>
              <li>{t('s3Category3')}</li>
              <li>{t('s3Category4')}</li>
            </ul>
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-bold text-ink">{t('s4Title')}</h2>
          <p className="text-gray-700">{t('s4Intro')}</p>
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
                  <td className="p-3">{t('s4Row1Purpose')}</td>
                  <td className="p-3">US, EU, LATAM</td>
                </tr>
                <tr className="border-b border-line hover:bg-gray-50">
                  <td className="p-3">MySQL Provider</td>
                  <td className="p-3">{t('s4Row2Purpose')}</td>
                  <td className="p-3">Configurable</td>
                </tr>
                <tr className="border-b border-line hover:bg-gray-50">
                  <td className="p-3">Paddle</td>
                  <td className="p-3">{t('s4Row3Purpose')}</td>
                  <td className="p-3">US/UK</td>
                </tr>
                <tr className="border-b border-line hover:bg-gray-50">
                  <td className="p-3">WorkOS</td>
                  <td className="p-3">{t('s4Row4Purpose')}</td>
                  <td className="p-3">US</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-sm text-gray-600 mt-4">
            {t('s4FooterBefore')}
            <Link href="/legal/subprocessors" className="text-brand-deep hover:underline">{t('s4FooterLinkText')}</Link>
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-bold text-ink">{t('s5Title')}</h2>
          <p className="text-gray-700">
            {t('s5BodyBefore')}
            <a href="mailto:privacy@cscloudsolutions.com.ar" className="text-brand-deep hover:underline">privacy@cscloudsolutions.com.ar</a>
            {t('s5BodyAfter')}
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-bold text-ink">{t('s6Title')}</h2>
          <p className="text-gray-700">{t('s6Intro')}</p>
          <ul className="list-disc list-inside space-y-2 text-gray-700">
            <li>{t('s6Bullet1')}</li>
            <li>{t('s6Bullet2')}</li>
            <li>{t('s6Bullet3')}</li>
            <li>{t('s6Bullet4')}</li>
            <li>{t('s6Bullet5')}</li>
          </ul>
          <p className="text-sm text-gray-600 mt-3">
            {t('s6FooterBefore')}
            <Link href="/legal/security" className="text-brand-deep hover:underline">{t('s6FooterLinkText')}</Link>
            {t('s6FooterAfter')}
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-bold text-ink">{t('s7Title')}</h2>
          <p className="text-gray-700">{t('s7Body')}</p>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-bold text-ink">{t('s8Title')}</h2>
          <p className="text-gray-700">{t('s8Body')}</p>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-bold text-ink">{t('annex1Title')}</h2>
          <p className="text-gray-700">
            {t('annex1Before')}
            <Link href="/legal/subprocessors" className="text-brand-deep hover:underline">{t('annex1LinkText')}</Link>.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-bold text-ink">{t('annex2Title')}</h2>
          <div className="space-y-3 text-gray-700">
            <p>{t('annex2Technical')}</p>
            <p>{t('annex2Organizational')}</p>
            <p className="text-sm">{t('annex2Details')}</p>
          </div>
        </section>

        <div className="mt-8 p-4 bg-gray-50 rounded-lg border border-line">
          <p className="text-sm text-gray-700">
            {t('footerLastUpdated', { date: new Date(LEGAL_VERSIONS.dpa).toLocaleDateString() })} |
            <Link href="/legal/terms" className="text-brand-deep hover:underline ml-2">{t('footerTermsLink')}</Link> |
            <Link href="/legal/privacy" className="text-brand-deep hover:underline ml-2">{t('footerPrivacyLink')}</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
