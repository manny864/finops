"use client";
import React, { useState } from 'react';
import { Link, usePathname } from '@/i18n/routing';
import { useTranslations } from 'next-intl';
import { 
    LayoutDashboard,
    Target,
    TrendingDown, 
    Lightbulb, 
    PieChart, 
    Zap, 
    Trash2, 
    Clock, 
    Tags, 
    Power, 
    Users,
    Settings,
    ChevronDown,
    ChevronRight,
    FileText,
    BookOpen,
    Activity,
    DollarSign,
    CreditCard
} from 'lucide-react';

interface SidebarProps {
    sidebarOpen: boolean;
}

export default function Sidebar({ sidebarOpen }: SidebarProps) {
    const pathname = usePathname();
    const t = useTranslations('Navigation');
    const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({
        visibilidad: true,
        inteligencia: true,
        limpieza: true,
        gobernanza: true,
        admin: true
    });

    const toggleGroup = (group: string) => {
        setOpenGroups(prev => ({ ...prev, [group]: !prev[group] }));
    };

    const categories = [
        {
            id: 'visibilidad',
            title: t('visibilidad'),
            items: [
                { href: '/', label: t('dashboard'), icon: LayoutDashboard },
                { href: '/advisor', label: t('advisor'), icon: Lightbulb },
                { href: '/overview/maturity', label: t('finops_maturity'), icon: Target },
                { href: '/overview/progress', label: t('historical_progress'), icon: TrendingDown }
            ]
        },
        {
            id: 'inteligencia',
            title: t('inteligencia'),
            items: [
                { href: '/intelligence/billing', label: t('billing'), icon: PieChart },
                { href: '/intelligence/rightsizing', label: t('rightsizing'), icon: Zap },
                { href: '/intelligence/network', label: t('network_analytics'), icon: Activity },
                { href: '/intelligence/rates', label: t('rate_optimization'), icon: DollarSign },
                { href: '/intelligence/chargeback', label: t('chargeback'), icon: CreditCard }
            ]
        },
        {
            id: 'limpieza',
            title: t('cleanup'),
            items: [
                { href: '/cleanup/zombies', label: t('zombie_resources'), icon: Trash2 },
                { href: '/cleanup/ttl', label: t('ttl_expirations'), icon: Clock }
            ]
        },
        {
            id: 'gobernanza',
            title: t('governance'),
            items: [
                { href: '/governance/tags', label: t('tag_compliance'), icon: Tags },
                { href: '/governance/power', label: t('power_schedules'), icon: Power }
            ]
        },
        {
            id: 'admin',
            title: t('admin'),
            items: [
                { href: '/admin/onboarding', label: t('client_onboarding'), icon: Users },
                { href: '/admin/config', label: t('configuration'), icon: Settings },
                { href: '/admin/report', label: t('executive_report'), icon: FileText },
                { href: '/admin/workbooks', label: t('workbooks'), icon: BookOpen },
                { href: '/admin/audit', label: t('audit_trail'), icon: Activity }
            ]
        }
    ];

    return (
        <aside className={`${sidebarOpen ? 'w-64' : 'w-20'} bg-white dark:bg-slate-900 border-r border-gray-200 dark:border-slate-800 transition-all duration-300 flex flex-col shadow-sm h-full`}>
            <div className="h-16 flex items-center justify-center border-b border-gray-200 dark:border-slate-800 px-4 shrink-0">
                <div className="flex items-center justify-center overflow-hidden w-full h-full">
                    {sidebarOpen ? (
                        <img src="/logo.png" alt="CSCloudSolutions FinOps" className="h-10 w-auto object-contain" />
                    ) : (
                        <div className="w-10 h-10 bg-[#0054A6] rounded-md flex items-center justify-center text-white font-bold text-xl shadow-sm">CS</div>
                    )}
                </div>
            </div>
            
            <nav className="flex-1 py-4 px-2 space-y-4 overflow-y-auto overflow-x-hidden">
                {categories.map(category => (
                    <div key={category.id} className="flex flex-col">
                        {sidebarOpen ? (
                            <button 
                                onClick={() => toggleGroup(category.id)}
                                className="flex items-center justify-between px-3 py-2 w-full text-left focus:outline-none group"
                            >
                                <span className="text-xs font-bold text-gray-400 uppercase tracking-wider group-hover:text-gray-600 transition-colors">
                                    {category.title}
                                </span>
                                {openGroups[category.id] ? 
                                    <ChevronDown className="w-4 h-4 text-gray-400 group-hover:text-gray-600" /> : 
                                    <ChevronRight className="w-4 h-4 text-gray-400 group-hover:text-gray-600" />
                                }
                            </button>
                        ) : (
                            <div className="h-8"></div>
                        )}
                        
                        {(openGroups[category.id] || !sidebarOpen) && (
                            <div className="space-y-1 mt-1">
                                {category.items.map(item => {
                                    const isActive = pathname === item.href;
                                    const Icon = item.icon;
                                    return (
                                        <Link 
                                            key={item.href} 
                                            href={item.href}
                                            title={sidebarOpen ? undefined : item.label}
                                            className={`w-full flex items-center px-3 py-2.5 rounded-lg font-medium transition-all duration-200 ${
                                                isActive 
                                                    ? 'bg-[#0054A6] text-white shadow-md' 
                                                    : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-800 hover:text-gray-900 dark:hover:text-white'
                                            }`}
                                        >
                                            <Icon className={`flex-shrink-0 ${sidebarOpen ? 'w-5 h-5 mr-3' : 'w-6 h-6 mx-auto'}`} />
                                            {sidebarOpen && <span className="text-sm truncate">{item.label}</span>}
                                        </Link>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                ))}
            </nav>
        </aside>
    );
}
