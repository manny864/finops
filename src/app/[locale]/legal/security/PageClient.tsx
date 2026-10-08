'use client';

import { useTranslations, useLocale } from 'next-intl';
import Link from 'next/link';
import { Shield, Lock, Eye, Server, AlertCircle, CheckCircle } from 'lucide-react';

// Sufijo de archivo por locale para los PDF generados en
// scripts/generate-trust-center-docs.js (docs/trust-center -> public/trust-center).
const TRUST_CENTER_LANG_SUFFIX: Record<string, string> = { es: 'ES', en: 'EN', 'pt-BR': 'PT-BR' };

export default function SecurityPage() {
  const t = useTranslations('LegalSecurity');
  const locale = useLocale();
  const langSuffix = TRUST_CENTER_LANG_SUFFIX[locale] || 'ES';

  return (
    <div className="min-h-screen bg-white dark:bg-slate-900 text-gray-900 dark:text-white">
      {/* Header */}
      <div className="bg-gradient-to-r from-brand-deep to-brand-bright text-white py-12">
        <div className="max-w-6xl mx-auto px-6">
          <div className="flex items-center gap-4 mb-6">
            <Shield className="w-12 h-12" />
            <h1 className="text-4xl font-bold">{t('heroTitle')}</h1>
          </div>
          <p className="text-lg opacity-90">{t('heroSubtitle')}</p>
        </div>
      </div>

      {/* Compliance Badges */}
      <div className="bg-gray-50 dark:bg-slate-950/60 border-b border-line dark:border-slate-800 py-8">
        <div className="max-w-6xl mx-auto px-6">
          <h2 className="text-xl font-bold text-ink dark:text-white mb-6">{t('complianceStatusTitle')}</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            <div className="bg-white dark:bg-slate-800/80 p-4 rounded-lg border border-line dark:border-slate-700 text-center">
              <div className="text-3xl mb-2">✓</div>
              <p className="font-semibold text-sm text-ink dark:text-white">{t('badgeGdprTitle')}</p>
              <p className="text-xs text-gray-600 dark:text-slate-300 mt-1">{t('badgeGdprSubtitle')}</p>
            </div>
            <div className="bg-white dark:bg-slate-800/80 p-4 rounded-lg border border-yellow-200 dark:border-yellow-600/40 text-center">
              <div className="text-3xl mb-2">⏳</div>
              <p className="font-semibold text-sm text-ink dark:text-white">{t('badgeSoc2Title')}</p>
              <p className="text-xs text-yellow-700 dark:text-yellow-400 font-medium">{t('badgeSoc2Subtitle')}</p>
            </div>
            <div className="bg-white dark:bg-slate-800/80 p-4 rounded-lg border border-line dark:border-slate-700 text-center">
              <div className="text-3xl mb-2">☁️</div>
              <p className="font-semibold text-sm text-ink dark:text-white">{t('badgeAzureTitle')}</p>
              <p className="text-xs text-gray-600 dark:text-slate-300 mt-1">{t('badgeAzureSubtitle')}</p>
            </div>
            <div className="bg-white dark:bg-slate-800/80 p-4 rounded-lg border border-line dark:border-slate-700 text-center">
              <div className="text-3xl mb-2">📋</div>
              <p className="font-semibold text-sm text-ink dark:text-white">{t('badgeIsoTitle')}</p>
              <p className="text-xs text-gray-600 dark:text-slate-300 mt-1">{t('badgeIsoSubtitle')}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-6xl mx-auto px-6 py-12 space-y-12">
        {/* Encryption */}
        <section className="space-y-4">
          <div className="flex items-center gap-3 mb-6">
            <Lock className="w-6 h-6 text-brand-deep dark:text-brand-bright" />
            <h2 className="text-2xl font-bold text-ink dark:text-white">{t('encryptionTitle')}</h2>
          </div>
          <div className="grid md:grid-cols-2 gap-6">
            <div className="bg-surface/50 dark:bg-slate-800/60 p-6 rounded-lg border border-line dark:border-slate-700">
              <h3 className="font-semibold text-ink dark:text-white mb-3">{t('encryptionTransitTitle')}</h3>
              <p className="text-gray-700 dark:text-white">{t('encryptionTransitBody')}</p>
            </div>
            <div className="bg-surface/50 dark:bg-slate-800/60 p-6 rounded-lg border border-line dark:border-slate-700">
              <h3 className="font-semibold text-ink dark:text-white mb-3">{t('encryptionRestTitle')}</h3>
              <p className="text-gray-700 dark:text-white">{t('encryptionRestBody')}</p>
            </div>
          </div>
        </section>

        {/* Access Control */}
        <section className="space-y-4">
          <div className="flex items-center gap-3 mb-6">
            <Eye className="w-6 h-6 text-brand-deep dark:text-brand-bright" />
            <h2 className="text-2xl font-bold text-ink dark:text-white">{t('accessTitle')}</h2>
          </div>
          <div className="space-y-3 text-gray-700 dark:text-white">
            <p>{t('accessAuth')}</p>
            <p>{t('accessAuthz')}</p>
            <p>{t('accessSso')}</p>
            <p>{t('accessSession')}</p>
          </div>
        </section>

        {/* Infrastructure */}
        <section className="space-y-4">
          <div className="flex items-center gap-3 mb-6">
            <Server className="w-6 h-6 text-brand-deep dark:text-brand-bright" />
            <h2 className="text-2xl font-bold text-ink dark:text-white">{t('infraTitle')}</h2>
          </div>
          <div className="space-y-4 text-gray-700 dark:text-white">
            <p>{t('infraProvider')}</p>
            <p>{t('infraRegion')}</p>
            <p>{t('infraDb')}</p>
            <p>{t('infraCache')}</p>
            <p>{t('infraEdge')}</p>
            <p>{t('infraDr')}</p>
            <p>{t('infraSla')}</p>
          </div>
        </section>

        {/* Audit & Monitoring */}
        <section className="space-y-4">
          <div className="flex items-center gap-3 mb-6">
            <AlertCircle className="w-6 h-6 text-brand-deep dark:text-brand-bright" />
            <h2 className="text-2xl font-bold text-ink dark:text-white">{t('auditTitle')}</h2>
          </div>
          <div className="space-y-4 text-gray-700 dark:text-white">
            <p>{t('auditLogs')}</p>
            <p>{t('auditMonitoring')}</p>
            <p>{t('auditIntrusion')}</p>
          </div>
        </section>

        {/* Subprocessors */}
        <section className="space-y-4">
          <h2 className="text-2xl font-bold text-ink dark:text-white">{t('subprocessorsTitle')}</h2>
          <p className="text-gray-700 dark:text-white mb-4">{t('subprocessorsIntro')}</p>
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
                  <td className="p-3">Paddle</td>
                  <td className="p-3">{t('procRow2Purpose')}</td>
                  <td className="p-3">US/UK</td>
                </tr>
                <tr className="border-b border-line dark:border-slate-800 hover:bg-gray-50 dark:hover:bg-slate-800/50 text-gray-700 dark:text-white">
                  <td className="p-3">WorkOS</td>
                  <td className="p-3">{t('procRow3Purpose')}</td>
                  <td className="p-3">US</td>
                </tr>
                <tr className="border-b border-line dark:border-slate-800 hover:bg-gray-50 dark:hover:bg-slate-800/50 text-gray-700 dark:text-white">
                  <td className="p-3">Google Gemini AI</td>
                  <td className="p-3">{t('procRow4Purpose')}</td>
                  <td className="p-3">US</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-sm text-gray-600 dark:text-slate-300 mt-4">
            {t('subprocessorsFooterBefore')}
            <Link href="/legal/subprocessors" className="text-brand-deep dark:text-brand-bright hover:underline">{t('subprocessorsFooterLinkText')}</Link>
          </p>
        </section>

        {/* Incident Response */}
        <section className="space-y-4">
          <h2 className="text-2xl font-bold text-ink dark:text-white">{t('incidentTitle')}</h2>
          <div className="space-y-3 text-gray-700 dark:text-white">
            <p>{t('incidentResponse')}</p>
            <p>{t('incidentNotification')}</p>
            <p>
              {t('incidentStatusBefore')}
              <a href="/status" className="text-brand-deep dark:text-brand-bright hover:underline">status.cscloudsolutions.com.ar</a>
            </p>
          </div>
        </section>

        {/* Download Documents */}
        <section className="space-y-4 bg-gray-50 dark:bg-slate-950/60 p-8 rounded-lg border border-line dark:border-slate-800">
          <h2 className="text-2xl font-bold text-ink dark:text-white mb-6">{t('downloadTitle')}</h2>
          <div className="grid md:grid-cols-2 gap-6">
            <a href={`/trust-center/DPA_${langSuffix}.pdf`} download className="flex items-center gap-4 p-4 bg-white dark:bg-slate-800/80 rounded-lg border border-line dark:border-slate-700 hover:border-brand-deep dark:hover:border-brand-bright transition-colors">
              <CheckCircle className="w-6 h-6 text-brand-deep dark:text-brand-bright flex-shrink-0" />
              <div>
                <p className="font-semibold text-ink dark:text-white">{t('downloadDpaTitle')}</p>
                <p className="text-xs text-gray-600 dark:text-slate-300">{t('downloadDpaSize')}</p>
              </div>
            </a>
            <a href={`/trust-center/SECURITY_WHITEPAPER_${langSuffix}.pdf`} download className="flex items-center gap-4 p-4 bg-white dark:bg-slate-800/80 rounded-lg border border-line dark:border-slate-700 hover:border-brand-deep dark:hover:border-brand-bright transition-colors">
              <CheckCircle className="w-6 h-6 text-brand-deep dark:text-brand-bright flex-shrink-0" />
              <div>
                <p className="font-semibold text-ink dark:text-white">{t('downloadWhitepaperTitle')}</p>
                <p className="text-xs text-gray-600 dark:text-slate-300">{t('downloadWhitepaperSize')}</p>
              </div>
            </a>
            <a href={`/trust-center/SOC2_REPORT_${langSuffix}.pdf`} download className="flex items-center gap-4 p-4 bg-white dark:bg-slate-800/80 rounded-lg border border-line dark:border-slate-700 hover:border-brand-deep dark:hover:border-brand-bright transition-colors">
              <CheckCircle className="w-6 h-6 text-brand-deep dark:text-brand-bright flex-shrink-0" />
              <div>
                <p className="font-semibold text-ink dark:text-white">{t('downloadSoc2Title')}</p>
                <p className="text-xs text-gray-600 dark:text-slate-300">{t('downloadSoc2Size')}</p>
              </div>
            </a>
            <a href={`/trust-center/SUBPROCESSORS_${langSuffix}.pdf`} download className="flex items-center gap-4 p-4 bg-white dark:bg-slate-800/80 rounded-lg border border-line dark:border-slate-700 hover:border-brand-deep dark:hover:border-brand-bright transition-colors">
              <CheckCircle className="w-6 h-6 text-brand-deep dark:text-brand-bright flex-shrink-0" />
              <div>
                <p className="font-semibold text-ink dark:text-white">{t('downloadSubprocessorsTitle')}</p>
                <p className="text-xs text-gray-600 dark:text-slate-300">{t('downloadSubprocessorsSize')}</p>
              </div>
            </a>
          </div>
        </section>

        {/* FAQ */}
        <section className="space-y-6">
          <h2 className="text-2xl font-bold text-ink dark:text-white">{t('faqTitle')}</h2>
          <div className="space-y-4">
            <details className="bg-gray-50 dark:bg-slate-800/60 p-4 rounded-lg cursor-pointer group border border-transparent dark:border-slate-700/60">
              <summary className="font-semibold text-ink dark:text-white group-open:text-brand-deep dark:group-open:text-brand-bright">{t('faq1Q')}</summary>
              <p className="text-gray-700 dark:text-white mt-3">{t('faq1A')}</p>
            </details>
            <details className="bg-gray-50 dark:bg-slate-800/60 p-4 rounded-lg cursor-pointer group border border-transparent dark:border-slate-700/60">
              <summary className="font-semibold text-ink dark:text-white group-open:text-brand-deep dark:group-open:text-brand-bright">{t('faq2Q')}</summary>
              <p className="text-gray-700 dark:text-white mt-3">{t('faq2A')}</p>
            </details>
            <details className="bg-gray-50 dark:bg-slate-800/60 p-4 rounded-lg cursor-pointer group border border-transparent dark:border-slate-700/60">
              <summary className="font-semibold text-ink dark:text-white group-open:text-brand-deep dark:group-open:text-brand-bright">{t('faq3Q')}</summary>
              <p className="text-gray-700 dark:text-white mt-3">{t('faq3A')}</p>
            </details>
            <details className="bg-gray-50 dark:bg-slate-800/60 p-4 rounded-lg cursor-pointer group border border-transparent dark:border-slate-700/60">
              <summary className="font-semibold text-ink dark:text-white group-open:text-brand-deep dark:group-open:text-brand-bright">{t('faq4Q')}</summary>
              <p className="text-gray-700 dark:text-white mt-3">{t('faq4A')}</p>
            </details>
          </div>
        </section>
      </div>
    </div>
  );
}
