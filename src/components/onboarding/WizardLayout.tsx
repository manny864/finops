'use client';

import React from 'react';
import { useTranslations } from 'next-intl';

interface WizardLayoutProps {
    title: string;
    description?: string;
    progressPercent: number;
    children: React.ReactNode;
    onSkipWizard?: () => void;
}

export default function WizardLayout({
    title,
    description,
    progressPercent,
    children,
    onSkipWizard,
}: WizardLayoutProps) {
    const t = useTranslations('OnboardingWizard');
    return (
        <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
            {/* Header */}
            <div className="border-b bg-white shadow-sm">
                <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
                        {description && <p className="text-sm text-gray-600 mt-1">{description}</p>}
                    </div>
                    {onSkipWizard && (
                        <button
                            onClick={onSkipWizard}
                            className="text-sm text-gray-500 hover:text-gray-700 underline"
                        >
                            {t('skipWizard')}
                        </button>
                    )}
                </div>
            </div>

            {/* Progress bar */}
            <div className="border-b bg-white py-3">
                <div className="max-w-4xl mx-auto px-4">
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-medium text-gray-600">{t('progress')}</span>
                        <span className="text-sm font-bold text-gray-900">{progressPercent}%</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                        <div
                            className="bg-gradient-to-r from-blue-500 to-blue-600 h-2 rounded-full transition-all duration-500"
                            style={{ width: `${progressPercent}%` }}
                        />
                    </div>
                </div>
            </div>

            {/* Content */}
            <div className="max-w-4xl mx-auto px-4 py-8">
                {children}
            </div>
        </div>
    );
}
