import React from 'react';
import { getTranslations } from 'next-intl/server';
import RemediationApprovals from '@/components/dashboard/RemediationApprovals';
import MockBanner from '@/components/MockBanner';
import { IconShield } from '@tabler/icons-react';

export default async function ApprovalsPage() {
    const t = await getTranslations('RemediationApprovals');
    return (
        <div className="content animate-in fade-in">
            <div className="vhead">
                <div>
                    <div className="vt">
                        <span className="vico !bg-transparent !shadow-none">
                            <IconShield className="w-5 h-5" />
                        </span>
                        {t('pageTitle')}
                    </div>
                    <div className="vs">{t('pageSubtitle')}</div>
                </div>
            </div>

            <div className="mt-6">
                <MockBanner />
                <RemediationApprovals />
            </div>
        </div>
    );
}
