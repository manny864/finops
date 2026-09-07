'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';

export default function SubprocessorsPage() {
  const t = useTranslations('LegalSubprocessors');

  const subprocessors = [
    {
      name: 'Microsoft Azure',
      purpose: t('procAzurePurpose'),
      locations: [t('locBrazil')],
      dpa: 'yes' as const,
    },
    {
      name: t('procMysqlName'),
      purpose: t('procMysqlPurpose'),
      locations: [t('locBrazil')],
      dpa: 'yes' as const,
    },
    {
      name: 'Paddle',
      purpose: t('procPaddlePurpose'),
      locations: [t('locUS'), t('locUK')],
      dpa: 'yes' as const,
    },
    {
      name: 'WorkOS',
      purpose: t('procWorkosPurpose'),
      locations: [t('locUS')],
      dpa: 'yes' as const,
    },
    {
      name: t('procGeminiName'),
      purpose: t('procGeminiPurpose'),
      locations: [t('locUS')],
      dpa: 'yes' as const,
    },
    {
      name: t('procGraphName'),
      purpose: t('procGraphPurpose'),
      locations: [t('locUS'), t('locEU')],
      dpa: 'yes' as const,
    },
  ];

  return (
    <div className="min-h-screen bg-white dark:bg-slate-900">
      {/* Header */}
      <div className="bg-gradient-to-r from-brand-deep/10 to-brand-bright/10 border-b border-line py-8">
        <div className="max-w-6xl mx-auto px-6">
          <h1 className="text-4xl font-bold text-ink mb-2">{t('title')}</h1>
          <p className="text-gray-600">{t('subtitle')}</p>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-12 space-y-8">
        <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-900">
          <p>
            <strong>{t('noteBefore')}</strong>
            {t('noteBody')}
          </p>
        </div>

        {/* Data Residency & Regional Subprocessors */}
        <div className="bg-indigo-50 border border-indigo-200 p-6 rounded-lg space-y-4">
          <h2 className="text-xl font-bold text-ink">{t('residencyTitle')}</h2>
          <p className="text-gray-700">{t('residencyBody')}</p>
          <div className="text-sm">
            <p className="font-semibold text-ink">{t('residencyRegionLabel')}</p>
            <p className="text-gray-700">{t('residencyRegionValue')}</p>
          </div>
          <p className="text-xs text-gray-600 pt-2">
            <strong>{t('residencyPlannedBefore')}</strong>
            {t('residencyPlannedBody')}
          </p>
        </div>

        {/* Subprocessors Table */}
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-gray-100 border-b-2 border-line">
                <th className="text-left p-4 font-semibold text-ink">{t('colProcessor')}</th>
                <th className="text-left p-4 font-semibold text-ink">{t('colPurpose')}</th>
                <th className="text-left p-4 font-semibold text-ink">{t('colLocations')}</th>
                <th className="text-center p-4 font-semibold text-ink">{t('colDpa')}</th>
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
          <h2 className="text-2xl font-bold text-ink">{t('detailsTitle')}</h2>

          {subprocessors.map((proc, idx) => (
            <div key={idx} className="bg-surface/50 p-6 rounded-lg border border-line space-y-3">
              <h3 className="text-lg font-bold text-ink">{proc.name}</h3>
              <p><strong>{t('detailPurposeLabel')}</strong> {proc.purpose}</p>
              <p><strong>{t('detailLocationsLabel')}</strong> {proc.locations.join(', ')}</p>
              <div className="text-sm text-gray-600 space-y-1 pt-2">
                <p>{t('detailProtection')}</p>
                {proc.dpa === 'yes' && <p>{t('detailDpaAvailable')}</p>}
              </div>
            </div>
          ))}
        </div>

        {/* Change Notification Policy */}
        <div className="bg-blue-50 border border-blue-200 p-6 rounded-lg space-y-4">
          <h2 className="text-xl font-bold text-ink">{t('changePolicyTitle')}</h2>
          <p className="text-gray-700">{t('changePolicyIntro')}</p>
          <ul className="list-disc list-inside space-y-2 text-gray-700">
            <li>{t('changeBullet1')}</li>
            <li>{t('changeBullet2')}</li>
            <li>{t('changeBullet3')}</li>
          </ul>
        </div>

        {/* Contact & Documentation */}
        <div className="grid md:grid-cols-2 gap-6">
          <div className="bg-surface/50 p-6 rounded-lg border border-line space-y-3">
            <h3 className="font-bold text-ink">{t('questionsTitle')}</h3>
            <p className="text-gray-700 text-sm">
              {t('questionsBodyBefore')}
              <a href="mailto:privacy@cscloudsolutions.com.ar" className="text-brand-deep hover:underline">privacy@cscloudsolutions.com.ar</a>
            </p>
          </div>
          <div className="bg-surface/50 p-6 rounded-lg border border-line space-y-3">
            <h3 className="font-bold text-ink">{t('relatedTitle')}</h3>
            <ul className="space-y-2 text-sm">
              <li><Link href="/legal/privacy" className="text-brand-deep hover:underline">{t('relatedPrivacy')}</Link></li>
              <li><Link href="/legal/dpa" className="text-brand-deep hover:underline">{t('relatedDpa')}</Link></li>
              <li><Link href="/legal/security" className="text-brand-deep hover:underline">{t('relatedSecurity')}</Link></li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
