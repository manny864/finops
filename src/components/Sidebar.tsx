"use client";
import React, { useState } from 'react';
import { Link, usePathname } from '@/i18n/routing';
import { useTranslations } from 'next-intl';
import { useMsal } from '@azure/msal-react';
import { isSuperAdmin } from '@/lib/authGuard';
import { useTenant } from '@/components/TenantProvider';
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
    CreditCard,
    Cpu,
    Leaf
} from 'lucide-react';

interface SidebarProps {
    sidebarOpen: boolean;
    setSidebarOpen: (open: boolean) => void;
}

export default function Sidebar({ sidebarOpen, setSidebarOpen }: SidebarProps) {
    const pathname = usePathname();
    const t = useTranslations('Navigation');
    const { accounts } = useMsal();
    const { selectedTenant } = useTenant();
    const tier = (selectedTenant as any).tier || 'Enterprise'; // Por defecto mostrar todo si no hay tier explícito
    
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
                { href: '/overview/progress', label: t('historical_progress'), icon: TrendingDown },
                { href: '/overview/sustainability', label: 'Green FinOps', icon: Leaf }
            ]
        },
        {
            id: 'inteligencia',
            title: t('inteligencia'),
            items: [
                { href: '/intelligence/billing', label: t('billing'), icon: PieChart },
                { href: '/intelligence/budgets', label: t('budgets', { fallback: 'Tenant Budgets' }), icon: DollarSign },
                { href: '/intelligence/rightsizing', label: t('rightsizing'), icon: Zap },
                { href: '/intelligence/network', label: t('network_analytics'), icon: Activity },
                { href: '/intelligence/rates', label: t('rate_optimization'), icon: DollarSign },
                { href: '/intelligence/chargeback', label: t('chargeback'), icon: CreditCard },
                { href: '/intelligence/licenses', label: t('licenses'), icon: Users },
                { href: '/intelligence/upload', label: 'Ingesta CSV', icon: FileText }
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
                { href: '/admin/users', label: 'Usuarios y Permisos', icon: Users },
                { href: '/admin/onboarding', label: t('client_onboarding'), icon: Users },
                { href: '/admin/config', label: t('configuration'), icon: Settings },
                { href: '/admin/report', label: t('executive_report'), icon: FileText },
                { href: '/admin/workbooks', label: t('workbooks'), icon: BookOpen },
                { href: '/admin/audit', label: t('audit_trail'), icon: Activity }
            ]
        }
    ];

    if (isSuperAdmin(accounts[0]?.username)) {
        categories.find(c => c.id === 'admin')?.items.push({
            href: '/superadmin/ai-config',
            label: 'Configuración de IA',
            icon: Cpu
        } as any);
        categories.find(c => c.id === 'admin')?.items.push({
            href: '/admin/payments',
            label: 'Configuración de Pagos',
            icon: CreditCard
        } as any);
    }

    // Filtrar categorías según el Tier
    const filteredCategories = categories.map(cat => {
        if (tier === 'Essential') {
            if (cat.id === 'visibilidad') return cat; // Todo visibilidad
            if (cat.id === 'limpieza') return { ...cat, items: cat.items.filter(i => i.href.includes('zombies')) }; // Solo zombies
            if (cat.id === 'admin') return { ...cat, items: cat.items.filter(i => i.href.includes('onboarding') || i.href.includes('users') || i.href.includes('config')) }; // Agregar Onboarding, Users, Config a Essential
            return null; // Ocultar el resto
        }
        if (tier === 'Professional') {
            if (cat.id === 'gobernanza') return null; // No tienen gobernanza
            if (cat.id === 'admin') return { ...cat, items: cat.items.filter(i => i.href.includes('report') || i.href.includes('onboarding') || i.href.includes('users') || i.href.includes('config')) }; // Reportes, Onboarding, Users, Config
            return cat;
        }
        if (tier === 'Business') {
            if (cat.id === 'gobernanza') return { ...cat, items: cat.items.filter(i => i.href.includes('tags')) }; // Solo tags
            if (cat.id === 'admin') return { ...cat, items: cat.items.filter(i => i.href.includes('report') || i.href.includes('audit') || i.href.includes('onboarding') || i.href.includes('users') || i.href.includes('config')) }; // Todo admin excepto quizas lo de super admin
            return cat;
        }
        return cat; // Enterprise ve todo
    }).filter(Boolean) as typeof categories;

    // RBAC logic
    const { userRole } = useTenant();
    const roleCategories = filteredCategories.map(cat => {
        if (userRole === 'Reader') {
            // Readers can only see visibility, and maybe reports
            if (cat.id === 'limpieza' || cat.id === 'gobernanza') return null;
            if (cat.id === 'admin') return { ...cat, items: cat.items.filter(i => i.href.includes('report')) };
            return cat;
        }
        if (userRole === 'Colaborador') {
            // Colaborador can't see users, config, billing
            if (cat.id === 'admin') return { ...cat, items: cat.items.filter(i => !i.href.includes('users') && !i.href.includes('config')) };
            return cat;
        }
        return cat; // Admin sees what the tier allows
    }).filter(Boolean) as typeof categories;

    return (
        <aside className={`${sidebarOpen ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0 fixed inset-y-0 left-0 z-50 md:relative ${sidebarOpen ? 'w-[252px]' : 'w-[64px]'} bg-gradient-to-b from-nav-bg to-nav-bg2 text-[#A9BBD0] border-r border-[#0a1726] transition-all duration-300 flex flex-col h-full custom-scrollbar`}>
            <div className="flex items-center gap-3 p-[18px_18px_14px] shrink-0">
                <div className="flex items-center justify-center overflow-hidden w-full">
                    {sidebarOpen ? (
                        <div className="flex items-center gap-3">
                            <img src="/logo_29k.png" alt="Logo" className="w-[34px] h-[34px] object-contain" />
                            <div className="flex flex-col">
                                <div className="font-heading font-extrabold text-[15px] text-white tracking-[0.2px] leading-none">CS<b className="text-brand-bright font-extrabold">Cloud</b>Solutions</div>
                                <div className="text-[9.5px] tracking-[2px] text-[#62809c] uppercase font-semibold mt-[3px]">FinOps Platform</div>
                            </div>
                        </div>
                    ) : (
                        <img src="/logo_29k.png" alt="Logo" className="w-[34px] h-[34px] object-contain" />
                    )}
                </div>
            </div>
            
            <nav className="flex-1 py-4 px-2 space-y-4 overflow-y-auto overflow-x-hidden">
                {roleCategories.map(category => (
                    <div key={category.id} className="flex flex-col">
                        {sidebarOpen ? (
                            <button 
                                onClick={() => toggleGroup(category.id)}
                                className="flex items-center justify-between px-3 py-2 w-full text-left focus:outline-none group"
                            >
                                <span className="text-[10px] font-bold text-[#566f8c] uppercase tracking-[1.6px] group-hover:text-white transition-colors">
                                    {category.title}
                                </span>
                                {openGroups[category.id] ? 
                                    <ChevronDown className="w-4 h-4 text-[#566f8c] group-hover:text-white" /> : 
                                    <ChevronRight className="w-4 h-4 text-[#566f8c] group-hover:text-white" />
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
                                            onClick={() => {
                                                if (window.innerWidth <= 768) {
                                                    setSidebarOpen(false);
                                                }
                                            }}
                                            className={`w-full flex items-center px-[11px] py-[9px] rounded-[10px] font-semibold transition-all duration-200 text-[13.5px] mb-1 ${
                                                isActive 
                                                    ? 'bg-gradient-to-br from-brand-deep to-[#1E88E5] text-white shadow-[0_6px_16px_rgba(0,84,166,0.4)]' 
                                                    : 'text-[#A9BBD0] hover:bg-white/5 hover:text-[#dce8f5]'
                                            }`}
                                        >
                                            <Icon className={`flex-shrink-0 ${sidebarOpen ? 'w-5 h-5 mr-3' : 'w-6 h-6 mx-auto'}`} />
                                            {sidebarOpen && <span className="text-sm truncate md:block">{item.label}</span>}
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
