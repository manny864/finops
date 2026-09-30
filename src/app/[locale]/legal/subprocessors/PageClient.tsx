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
    <div className="min-h-screen bg-white dark:bg-slate-900 text-gray-900 dark:text-white">
      {/* Header */}
      <div className="bg-gradient-to-r from-brand-deep/10 to-brand-bright/10 dark:from-brand-deep/20 dark:to-brand-bright/20 border-b border-line dark:border-slate-800 py-8">
        <div className="max-w-6xl mx-auto px-6">
          <h1 className="text-4xl font-bold text-ink dark:text-white mb-2">{t('title')}</h1>
          <p className="text-gray-600 dark:text-slate-300">{t('subtitle')}</p>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-12 space-y-8">
        <div className="p-4 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 rounded-lg text-sm text-blue-900 dark:text-blue-200">
          <p>
            <strong>{t('noteBefore')}</strong>
            {t('noteBody')}
          </p>
        </div>

        {/* Data Residency & Regional Subprocessors */}
        <div className="bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800 p-6 rounded-lg space-y-4">
          <h2 className="text-xl font-bold text-ink dark:text-white">{t('residencyTitle')}</h2>
          <p className="text-gray-700 dark:text-white">{t('residencyBody')}</p>
          <div className="text-sm">
            <p className="font-semibold text-ink dark:text-white">{t('residencyRegionLabel')}</p>
            <p className="text-gray-700 dark:text-white">{t('residencyRegionValue')}</p>
          </div>
          <p className="text-xs text-gray-600 dark:text-slate-300 pt-2">
            <strong>{t('residencyPlannedBefore')}</strong>
            {t('residencyPlannedBody')}
          </p>
        </div>

        {/* Subprocessors Table */}
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-gray-100 dark:bg-slate-800 border-b-2 border-line dark:border-slate-700">
                <th className="text-left p-4 font-semibold text-ink dark:text-white">{t('colProcessor')}</th>
                <th className="text-left p-4 font-semibold text-ink dark:text-white">{t('colPurpose')}</th>
                <th className="text-left p-4 font-semibold text-ink dark:text-white">{t('colLocations')}</th>
                <th className="text-center p-4 font-semibold text-ink dark:text-white">{t('colDpa')}</th>
              </tr>
            </thead>
            <tbody>
              {subprocessors.map((proc, idx) => (
                <tr key={idx} className="border-b border-line dark:border-slate-800 hover:bg-gray-50 dark:hover:bg-slate-800/50">
                  <td className="p-4 font-semibold text-ink dark:text-white">{proc.name}</td>
                  <td className="p-4 text-gray-700 dark:text-white">{proc.purpose}</td>
                  <td className="p-4 text-gray-700 dark:text-white">
                    <div className="flex flex-wrap gap-2">
                      {proc.locations.map((loc, i) => (
                        <span key={i} className="px-2 py-1 bg-gray-100 dark:bg-slate-800 text-sm rounded text-gray-700 dark:text-white border border-transparent dark:border-slate-700">
                          {loc}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="p-4 text-center">
                    {proc.dpa === 'yes' && <span className="text-green-600 dark:text-green-400 font-bold">✓</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Detailed Processor Info */}
        <div className="space-y-8">
          <h2 className="text-2xl font-bold text-ink dark:text-white">{t('detailsTitle')}</h2>

          {subprocessors.map((proc, idx) => (
            <div key={idx} className="bg-surface/50 dark:bg-slate-800/60 p-6 rounded-lg border border-line dark:border-slate-700 space-y-3">
              <h3 className="text-lg font-bold text-ink dark:text-white">{proc.name}</h3>
              <p className="text-gray-700 dark:text-white"><strong>{t('detailPurposeLabel')}</strong> {proc.purpose}</p>
              <p className="text-gray-700 dark:text-white"><strong>{t('detailLocationsLabel')}</strong> {proc.locations.join(', ')}</p>
              <div className="text-sm text-gray-600 dark:text-slate-300 space-y-1 pt-2">
                <p>{t('detailProtection')}</p>
                {proc.dpa === 'yes' && <p>{t('detailDpaAvailable')}</p>}
              </div>
            </div>
          ))}
        </div>

        {/* Change Notification Policy */}
        <div className="bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 p-6 rounded-lg space-y-4">
          <h2 className="text-xl font-bold text-ink dark:text-white">{t('changePolicyTitle')}</h2>
          <p className="text-gray-700 dark:text-white">{t('changePolicyIntro')}</p>
          <ul className="list-disc list-inside space-y-2 text-gray-700 dark:text-white">
            <li>{t('changeBullet1')}</li>
            <li>{t('changeBullet2')}</li>
            <li>{t('changeBullet3')}</li>
          </ul>
        </div>

        {/* Contact & Documentation */}
        <div className="grid md:grid-cols-2 gap-6">
          <div className="bg-surface/50 dark:bg-slate-800/60 p-6 rounded-lg border border-line dark:border-slate-700 space-y-3">
            <h3 className="font-bold text-ink dark:text-white">{t('questionsTitle')}</h3>
            <p className="text-gray-700 dark:text-white text-sm">
              {t('questionsBodyBefore')}
              <a href="mailto:privacy@cscloudsolutions.com.ar" className="text-brand-deep dark:text-brand-bright hover:underline">privacy@cscloudsolutions.com.ar</a>
            </p>
          </div>
          <div className="bg-surface/50 dark:bg-slate-800/60 p-6 rounded-lg border border-line dark:border-slate-700 space-y-3">
            <h3 className="font-bold text-ink dark:text-white">{t('relatedTitle')}</h3>
            <ul className="space-y-2 text-sm">
              <li><Link href="/legal/privacy" className="text-brand-deep dark:text-brand-bright hover:underline">{t('relatedPrivacy')}</Link></li>
              <li><Link href="/legal/dpa" className="text-brand-deep dark:text-brand-bright hover:underline">{t('relatedDpa')}</Link></li>
              <li><Link href="/legal/security" className="text-brand-deep dark:text-brand-bright hover:underline">{t('relatedSecurity')}</Link></li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
