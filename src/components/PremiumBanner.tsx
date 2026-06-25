import React from 'react';
import { ShieldAlert, Zap, Lock, Crown } from 'lucide-react';
import { useTranslations } from 'next-intl';

interface PremiumBannerProps {
    title: string;
    description: string;
    requiredTier: 'Professional' | 'Business' | 'Enterprise';
    icon?: 'shield' | 'zap' | 'lock' | 'crown';
}

export default function PremiumBanner({ title, description, requiredTier, icon = 'crown' }: PremiumBannerProps) {
    const t = useTranslations('Common');

    const renderIcon = () => {
        const props = { className: "w-12 h-12 text-amber-500 mx-auto mb-4" };
        switch (icon) {
            case 'shield': return <ShieldAlert {...props} />;
            case 'zap': return <Zap {...props} />;
            case 'lock': return <Lock {...props} />;
            case 'crown':
            default: return <Crown {...props} />;
        }
    };

    return (
        <div className="p-6">
            <div className="bg-white dark:bg-slate-900 border border-amber-200 dark:border-amber-900/50 rounded-xl p-8 text-center max-w-2xl mx-auto shadow-sm">
                {renderIcon()}
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">{title}</h2>
                <p className="text-gray-600 dark:text-gray-400 mb-6">
                    {description}
                    <br /><br />
                    Esta característica está disponible exclusivamente a partir del plan <b>{requiredTier}</b>.
                </p>
                <button className="px-6 py-3 bg-brand-deep text-white font-bold rounded-lg shadow hover:bg-brand-bright transition-colors">
                    Actualizar a {requiredTier}
                </button>
            </div>
        </div>
    );
}
