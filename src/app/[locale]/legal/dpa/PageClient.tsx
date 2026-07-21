'use client';

import { useTranslations } from 'next-intl';
import { LEGAL_VERSIONS } from '@/lib/legalVersions';
import Link from 'next/link';
import { useState } from 'react';
import { CheckCircle2 } from 'lucide-react';

export default function DPAPage() {
  const t = useTranslations('LegalDpa');
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
          <h1 className="text-4xl font-bold text-ink mb-2">{t('title')}</h1>
          <p className="text-gray-600 mb-4">{t('subtitle')}</p>
          <p className="text-gray-600">
            {t('lastUpdated', { date: new Date(LEGAL_VERSIONS.dpa).toLocaleDateString() })}
          </p>
          <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-900">
            {t('reviewPending')}
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
                <p className="font-semibold">{t('signedTitle')}</p>
                <p className="text-sm">{t('signedBy', { user: signingUser ?? '', date: new Date().toLocaleDateString() })}</p>
              </div>
            </div>
          ) : (
            <div>
              <p className="text-gray-700 mb-4">{t('unsignedIntro')}</p>
              <button
                onClick={handleSign}
                className="px-6 py-2 bg-brand-deep text-white rounded-lg hover:brightness-110 transition-all font-semibold"
              >
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
