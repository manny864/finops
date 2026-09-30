'use client';

import { useTranslations } from 'next-intl';
import { getLegalVersionDate } from '@/lib/legalVersions';
import Link from 'next/link';

export default function TermsPage() {
  const t = useTranslations('LegalTerms');
  const lastUpdated = getLegalVersionDate('terms').toLocaleDateString();

  return (
    <div className="min-h-screen bg-white dark:bg-slate-900 text-gray-900 dark:text-white">
      {/* Header */}
      <div className="bg-gradient-to-r from-brand-deep/10 to-brand-bright/10 dark:from-brand-deep/20 dark:to-brand-bright/20 border-b border-line dark:border-slate-800 py-8">
        <div className="max-w-4xl mx-auto px-6">
          <h1 className="text-4xl font-bold text-ink dark:text-white mb-2">{t('title')}</h1>
          <p className="text-gray-600 dark:text-slate-300">{t('lastUpdated', { date: lastUpdated })}</p>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-12 space-y-8">
        <section className="space-y-4">
          <h2 className="text-2xl font-bold text-ink dark:text-white">{t('s1Title')}</h2>
          <p className="text-gray-700 dark:text-white">{t('s1Body')}</p>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-bold text-ink dark:text-white">{t('s2Title')}</h2>
          <p className="text-gray-700 dark:text-white">{t('s2Body')}</p>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-bold text-ink dark:text-white">{t('s3Title')}</h2>
          <p className="text-gray-700 dark:text-white">{t('s3Intro')}</p>
          <ul className="list-disc list-inside space-y-2 text-gray-700 dark:text-white">
            <li>{t('s3Bullet1')}</li>
            <li>{t('s3Bullet2')}</li>
            <li>{t('s3Bullet3')}</li>
            <li>{t('s3Bullet4')}</li>
            <li>{t('s3Bullet5')}</li>
            <li>{t('s3Bullet6')}</li>
          </ul>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-bold text-ink dark:text-white">{t('s4Title')}</h2>
          <p className="text-gray-700 dark:text-white">{t('s4Body')}</p>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-bold text-ink dark:text-white">{t('s5Title')}</h2>
          <p className="text-gray-700 dark:text-white">{t('s5Intro')}</p>
          <ul className="list-disc list-inside space-y-2 text-gray-700 dark:text-white">
            <li>{t('s5Bullet1')}</li>
            <li>{t('s5Bullet2')}</li>
            <li>{t('s5Bullet3')}</li>
            <li>{t('s5Bullet4')}</li>
          </ul>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-bold text-ink dark:text-white">{t('s6Title')}</h2>
          <p className="text-gray-700 dark:text-white">{t('s6Body')}</p>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-bold text-ink dark:text-white">{t('s7Title')}</h2>
          <p className="text-gray-700 dark:text-white">{t('s7Body')}</p>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-bold text-ink dark:text-white">{t('s8Title')}</h2>
          <p className="text-gray-700 dark:text-white">{t('s8Body')}</p>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-bold text-ink dark:text-white">{t('s9Title')}</h2>
          <p className="text-gray-700 dark:text-white">{t('s9Body')}</p>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-bold text-ink dark:text-white">{t('s10Title')}</h2>
          <p className="text-gray-700 dark:text-white">{t('s10Body')}</p>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-bold text-ink dark:text-white">{t('s11Title')}</h2>
          <p className="text-gray-700 dark:text-white">
            {t('s11BodyBefore')}
            <Link href="/legal/dpa" className="text-brand-deep dark:text-brand-bright hover:underline">{t('s11LinkText')}</Link>
            {t('s11BodyAfter')}
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-bold text-ink dark:text-white">{t('s12Title')}</h2>
          <p className="text-gray-700 dark:text-white">{t('s12Body')}</p>
        </section>

        <div className="mt-8 p-4 bg-gray-50 dark:bg-slate-800/60 rounded-lg border border-line dark:border-slate-700">
          <p className="text-sm text-gray-700 dark:text-white">
            {t('footerLastUpdated', { date: lastUpdated })} |
            <Link href="/legal/privacy" className="text-brand-deep dark:text-brand-bright hover:underline ml-2">{t('footerPrivacyLink')}</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
