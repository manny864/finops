'use client';

import { useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/routing';

export default function PublicFooter() {
  const t = useTranslations('Footer');
  const pathname = usePathname() || '';
  const currentYear = new Date().getFullYear();

  // Don't show footer on auth pages
  if (pathname.includes('/login') || pathname.includes('/auth')) {
    return null;
  }

  return (
    <footer className="bg-surface border-t border-line mt-auto py-8">
      <div className="max-w-7xl mx-auto px-6">
        <div className="flex flex-col md:flex-row items-center justify-between gap-6">
          {/* Links */}
          <div className="flex flex-wrap items-center justify-center md:justify-start gap-4 text-sm">
            <Link href="/legal/privacy" className="text-gray-600 hover:text-brand-deep transition-colors">
              {t('privacy')}
            </Link>
            <span className="text-gray-300">·</span>
            <Link href="/legal/terms" className="text-gray-600 hover:text-brand-deep transition-colors">
              {t('terms')}
            </Link>
            <span className="text-gray-300">·</span>
            <Link href="/legal/dpa" className="text-gray-600 hover:text-brand-deep transition-colors">
              {t('dpa')}
            </Link>
            <span className="text-gray-300">·</span>
            <Link href="/legal/security" className="text-gray-600 hover:text-brand-deep transition-colors">
              {t('security')}
            </Link>
            <span className="text-gray-300">·</span>
            <Link href="/legal/subprocessors" className="text-gray-600 hover:text-brand-deep transition-colors">
              {t('subprocessors')}
            </Link>
            <span className="text-gray-300">·</span>
            <Link href="/status" className="text-gray-600 hover:text-brand-deep transition-colors">
              {t('status')}
            </Link>
          </div>

          {/* Copyright */}
          <div className="text-xs text-gray-500 text-center md:text-right">
            {t('copyright', { year: currentYear })}
          </div>
        </div>
      </div>
    </footer>
  );
}
