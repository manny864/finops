'use client';

import { useTranslations } from 'next-intl';
import { getLegalVersionDate } from '@/lib/legalVersions';
import { useState } from 'react';
import Link from 'next/link';

type Section = 'data-collection' | 'usage' | 'processors' | 'retention' | 'rights' | 'transfers' | 'contact';

export default function PrivacyPage() {
  const t = useTranslations('LegalPrivacy');
  const [activeSection, setActiveSection] = useState<Section>('data-collection');

  const sections: { id: Section; title: string }[] = [
    { id: 'data-collection', title: t('navDataCollection') },
    { id: 'usage', title: t('navUsage') },
    { id: 'processors', title: t('navProcessors') },
    { id: 'retention', title: t('navRetention') },
    { id: 'rights', title: t('navRights') },
    { id: 'transfers', title: t('navTransfers') },
    { id: 'contact', title: t('navContact') },
  ];

  return (
    <div className="min-h-screen bg-white dark:bg-slate-900 text-gray-900 dark:text-white">
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-brand-deep/10 to-brand-bright/10 dark:from-brand-deep/20 dark:to-brand-bright/20 border-b border-line dark:border-slate-800 py-8">
        <div className="max-w-7xl mx-auto px-6">
          <h1 className="text-4xl font-bold text-ink dark:text-white mb-2">{t('title')}</h1>
          <p className="text-gray-600 dark:text-slate-300">
            {t('lastUpdated', { date: getLegalVersionDate('privacy').toLocaleDateString() })}
          </p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-12 grid grid-cols-1 lg:grid-cols-4 gap-8">
        {/* Sidebar TOC */}
        <div className="lg:col-span-1">
          <div className="sticky top-20 bg-surface/50 dark:bg-slate-800/70 rounded-lg p-4 border border-line dark:border-slate-700">
            <h3 className="font-bold text-ink dark:text-white mb-4">{t('tocTitle')}</h3>
            <nav className="space-y-2">
              {sections.map((section) => (
                <button
                  key={section.id}
                  onClick={() => setActiveSection(section.id)}
                  className={`w-full text-left px-3 py-2 rounded text-sm transition-colors ${
                    activeSection === section.id
                      ? 'bg-brand-deep text-white font-semibold'
                      : 'text-gray-700 dark:text-slate-200 hover:bg-gray-100 dark:hover:bg-slate-700/60 dark:hover:text-white'
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
              <h2 className="text-2xl font-bold text-ink dark:text-white">{t('dcTitle')}</h2>
              <p className="text-gray-700 dark:text-white leading-relaxed">{t('dcIntro')}</p>
              <ul className="list-disc list-inside space-y-3 text-gray-700 dark:text-white">
                <li>{t('dcBullet1')}</li>
                <li>{t('dcBullet2')}</li>
                <li>{t('dcBullet3')}</li>
                <li>{t('dcBullet4')}</li>
                <li>{t('dcBullet5')}</li>
              </ul>
            </section>
          )}

          {/* Usage */}
          {activeSection === 'usage' && (
            <section id="usage" className="space-y-4">
              <h2 className="text-2xl font-bold text-ink dark:text-white">{t('usageTitle')}</h2>
              <div className="space-y-4">
                <div>
                  <h3 className="font-semibold text-ink dark:text-white mb-2">{t('usageServiceTitle')}</h3>
                  <p className="text-gray-700 dark:text-white">{t('usageServiceBody')}</p>
                </div>
                <div>
                  <h3 className="font-semibold text-ink dark:text-white mb-2">{t('usagePlatformTitle')}</h3>
                  <p className="text-gray-700 dark:text-white">{t('usagePlatformBody')}</p>
                </div>
                <div>
                  <h3 className="font-semibold text-ink dark:text-white mb-2">{t('usageSecurityTitle')}</h3>
                  <p className="text-gray-700 dark:text-white">{t('usageSecurityBody')}</p>
                </div>
              </div>
            </section>
          )}

          {/* Processors */}
          {activeSection === 'processors' && (
            <section id="processors" className="space-y-4">
              <h2 className="text-2xl font-bold text-ink dark:text-white">{t('procTitle')}</h2>
              <p className="text-gray-700 dark:text-white">{t('procIntro')}</p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="bg-gray-100 dark:bg-slate-800 border-b border-line dark:border-slate-700 text-gray-800 dark:text-white">
                      <th className="text-left p-3 font-semibold">{t('procColProcessor')}</th>
                      <th className="text-left p-3 font-semibold">{t('procColPurpose')}</th>
                      <th className="text-left p-3 font-semibold">{t('procColLocation')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b border-line dark:border-slate-800 hover:bg-gray-50 dark:hover:bg-slate-800/50 text-gray-700 dark:text-white">
                      <td className="p-3">Microsoft Azure</td>
                      <td className="p-3">{t('procRow1Purpose')}</td>
                      <td className="p-3">US, EU, LATAM</td>
                    </tr>
                    <tr className="border-b border-line dark:border-slate-800 hover:bg-gray-50 dark:hover:bg-slate-800/50 text-gray-700 dark:text-white">
                      <td className="p-3">MySQL Host</td>
                      <td className="p-3">{t('procRow2Purpose')}</td>
                      <td className="p-3">Configurable</td>
                    </tr>
                    <tr className="border-b border-line dark:border-slate-800 hover:bg-gray-50 dark:hover:bg-slate-800/50 text-gray-700 dark:text-white">
                      <td className="p-3">Paddle</td>
                      <td className="p-3">{t('procRow3Purpose')}</td>
                      <td className="p-3">US/UK</td>
                    </tr>
                    <tr className="border-b border-line dark:border-slate-800 hover:bg-gray-50 dark:hover:bg-slate-800/50 text-gray-700 dark:text-white">
                      <td className="p-3">WorkOS</td>
                      <td className="p-3">{t('procRow4Purpose')}</td>
                      <td className="p-3">US</td>
                    </tr>
                    <tr className="border-b border-line dark:border-slate-800 hover:bg-gray-50 dark:hover:bg-slate-800/50 text-gray-700 dark:text-white">
                      <td className="p-3">Google Gemini AI</td>
                      <td className="p-3">{t('procRow5Purpose')}</td>
                      <td className="p-3">US</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="text-sm text-gray-600 dark:text-slate-300 mt-4">
                {t('procFooterBefore')}
                <Link href="/legal/subprocessors" className="text-brand-deep dark:text-brand-bright hover:underline">{t('procFooterLinkText')}</Link>
                {t('procFooterAfter')}
              </p>
            </section>
          )}

          {/* Retention */}
          {activeSection === 'retention' && (
            <section id="retention" className="space-y-4">
              <h2 className="text-2xl font-bold text-ink dark:text-white">{t('retentionTitle')}</h2>
              <div className="space-y-4">
                <div>
                  <h3 className="font-semibold text-ink dark:text-white mb-2">{t('retentionTelemetryTitle')}</h3>
                  <p className="text-gray-700 dark:text-white">{t('retentionTelemetryBody')}</p>
                </div>
                <div>
                  <h3 className="font-semibold text-ink dark:text-white mb-2">{t('retentionBillingTitle')}</h3>
                  <p className="text-gray-700 dark:text-white">{t('retentionBillingBody')}</p>
                </div>
                <div>
                  <h3 className="font-semibold text-ink dark:text-white mb-2">{t('retentionAuditTitle')}</h3>
                  <p className="text-gray-700 dark:text-white">{t('retentionAuditBody')}</p>
                </div>
                <div>
                  <h3 className="font-semibold text-ink dark:text-white mb-2">{t('retentionAccountTitle')}</h3>
                  <p className="text-gray-700 dark:text-white">{t('retentionAccountBody')}</p>
                </div>
              </div>
            </section>
          )}

          {/* Rights */}
          {activeSection === 'rights' && (
            <section id="rights" className="space-y-4">
              <h2 className="text-2xl font-bold text-ink dark:text-white">{t('rightsTitle')}</h2>
              <p className="text-gray-700 dark:text-white">{t('rightsIntro')}</p>
              <ul className="list-disc list-inside space-y-2 text-gray-700 dark:text-white">
                <li>{t('rightsBullet1')}</li>
                <li>{t('rightsBullet2')}</li>
                <li>{t('rightsBullet3')}</li>
                <li>{t('rightsBullet4')}</li>
                <li>{t('rightsBullet5')}</li>
                <li>{t('rightsBullet6')}</li>
              </ul>
              <p className="text-gray-700 dark:text-white mt-4">
                {t('rightsContactBefore')}
                <a href="mailto:privacy@cscloudsolutions.com.ar" className="text-brand-deep dark:text-brand-bright hover:underline">privacy@cscloudsolutions.com.ar</a>
                {t('rightsContactAfter')}
              </p>
            </section>
          )}

          {/* International Transfers */}
          {activeSection === 'transfers' && (
            <section id="transfers" className="space-y-4">
              <h2 className="text-2xl font-bold text-ink dark:text-white">{t('transfersTitle')}</h2>
              <p className="text-gray-700 dark:text-white">{t('transfersBody1')}</p>
              <p className="text-gray-700 dark:text-white">{t('transfersBody2')}</p>
            </section>
          )}

          {/* Contact */}
          {activeSection === 'contact' && (
            <section id="contact" className="space-y-4">
              <h2 className="text-2xl font-bold text-ink dark:text-white">{t('contactTitle')}</h2>
              <div className="space-y-3 text-gray-700 dark:text-white">
                <p>
                  <strong>{t('contactOfficerLabel')}</strong><br />
                  privacy@cscloudsolutions.com.ar
                </p>
                <p>
                  <strong>{t('contactCompanyLabel')}</strong><br />
                  CSCloudSolutions<br />
                  {t('contactCity')}
                </p>
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
