"use client";
import React, { useState } from 'react';
import { Link, usePathname } from '@/i18n/routing';
import { useTranslations } from 'next-intl';
import { useMsal } from '@azure/msal-react';
import { isSuperAdmin } from '@/lib/authGuard';
import { useTenant } from '@/components/TenantProvider';
import FeatureGuard from '@/components/FeatureGuard';
import { hasAccess } from '@/lib/tierLogic';
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
    Leaf,
    Building2,
    Box,
    Server,
    ShieldCheck,
    Trophy,
    CheckCircle,
    ShieldAlert,
    Layers,
    HardDrive,
    BellRing,
    Bell,
    Sparkles,
    Briefcase,
    KeyRound,
    Unlock,
    Database,
    BarChart3,
    FileSpreadsheet,
    Bot,
    Globe,
    TrendingUp,
    Cloud
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
    const tier = (selectedTenant as any).tier || 'Essential';
    
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
                { href: '/academy', label: 'Academia FinOps', icon: BookOpen },
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
                { href: '/intelligence/billing', label: t('billing'), icon: PieChart, requiredTier: 'Professional' },
                { href: '/intelligence/budgets', label: t('budgets', { fallback: 'Tenant Budgets' }), icon: DollarSign, requiredTier: 'Professional' },
                { href: '/intelligence/rightsizing', label: t('rightsizing'), icon: Zap, requiredTier: 'Professional' },
                { href: '/intelligence/network', label: t('network_analytics'), icon: Activity, requiredTier: 'Professional' },
                { href: '/intelligence/rates', label: t('rate_optimization'), icon: DollarSign, requiredTier: 'Business' },
                { href: '/intelligence/licenses', label: t('licenses'), icon: Users, requiredTier: 'Professional' },
                { href: '/intelligence/hybrid-benefit', label: 'Hybrid Benefit (AHB)', icon: Cpu, requiredTier: 'Professional' },
                { href: '/intelligence/commitments', label: 'Reservas (RIs)', icon: ShieldCheck, requiredTier: 'Professional' },
                { href: '/intelligence/zero-cost', label: 'Costo Cero', icon: Box },
                { href: '/intelligence/aks', label: 'Control AKS', icon: Server, requiredTier: 'Business' },
                { href: '/intelligence/aks-chargeback', label: 'AKS Chargeback', icon: Layers, requiredTier: 'Enterprise' },
                { href: '/intelligence/unit-economics', label: 'Unit Economics', icon: Activity, requiredTier: 'Business' },
                { href: '/intelligence/allocation', label: 'Prorrateo (Allocation)', icon: PieChart, requiredTier: 'Enterprise' },
                { href: '/intelligence/scorecard', label: 'Scorecard (Fama)', icon: Trophy, requiredTier: 'Enterprise' },
                { href: '/intelligence/anomalies', label: 'Detección Anomalías', icon: ShieldAlert, requiredTier: 'Professional' },
                { href: '/intelligence/simulator', label: 'Simulador (What-If)', icon: Activity, requiredTier: 'Enterprise' },
                { href: '/intelligence/storage-efficiency', label: t('storage_efficiency', { fallback: 'Eficiencia de Storage' }), icon: HardDrive, requiredTier: 'Business' },
                { href: '/intelligence/compute-efficiency', label: t('compute_efficiency', { fallback: 'Eficiencia de Cómputo' }), icon: Cpu, requiredTier: 'Professional' },
                { href: '/intelligence/alerts', label: t('alerts_self_service', { fallback: 'Alertas (Self-Service)' }), icon: BellRing, requiredTier: 'Professional' },
                { href: '/intelligence/ai-analytics', label: t('ai_analytics', { fallback: 'AI Cost Analytics' }), icon: Sparkles, requiredTier: 'Enterprise' },
                { href: '/intelligence/macc', label: t('macc', { fallback: 'MACC Tracking' }), icon: Briefcase, requiredTier: 'Enterprise' },
                { href: '/intelligence/upload', label: 'Ingesta CSV', icon: FileText }
            ]
        },
        {
            id: 'limpieza',
            title: t('cleanup'),
            items: [
                { href: '/cleanup/zombies', label: t('zombie_resources'), icon: Trash2 },
                { href: '/cleanup/ttl', label: t('ttl_expirations'), icon: Clock, requiredTier: 'Professional' }
            ]
        },
        {
            id: 'gobernanza',
            title: t('governance'),
            items: [
                { href: '/governance/tags', label: t('tag_compliance'), icon: Tags, requiredTier: 'Business' },
                { href: '/governance/power', label: t('power_schedules'), icon: Power, requiredTier: 'Business' },
                { href: '/governance/policies', label: 'Políticas (Auto-Block)', icon: ShieldAlert, requiredTier: 'Enterprise' },
                { href: '/governance/ha', label: t('ha_recommendations', { fallback: 'Alta Disponibilidad' }), icon: ShieldCheck, requiredTier: 'Business' },
                { href: '/governance/credentials', label: t('expiring_credentials', { fallback: 'Credenciales por Expirar' }), icon: KeyRound, requiredTier: 'Business' },
                { href: '/remediation/approvals', label: 'Aprobaciones', icon: CheckCircle, requiredTier: 'Professional' }
            ]
        },
        {
            id: 'admin',
            title: t('admin'),
            items: [
                { href: '/admin/users', label: 'Usuarios y Permisos', icon: Users },
                { href: '/admin/onboarding', label: t('client_onboarding'), icon: Users },
                { href: '/admin/config', label: t('configuration'), icon: Settings },
                { href: '/admin/markup', label: 'Partner Markup (CSP)', icon: DollarSign, requiredTier: 'Enterprise' },
                { href: '/admin/ai-config', label: 'Configuración de IA', icon: Cpu },
                { href: '/admin/report', label: t('executive_report'), icon: FileText },
                { href: '/admin/workbooks', label: t('workbooks'), icon: BookOpen },
                { href: '/admin/notifications', label: 'Notificaciones', icon: Bell, requiredTier: 'Professional' },
                { href: '/admin/billing', label: 'Facturación', icon: CreditCard, requiredTier: 'Essential' },
                { href: '/admin/copilot-m365', label: t('copilot_m365', { fallback: 'Copilot M365' }), icon: Bot, requiredTier: 'Enterprise' },
                { href: '/admin/audit', label: t('audit_trail'), icon: Activity },
                { href: '/admin/pricing-units', label: 'Pricing Units', icon: Database },
                { href: '/admin/mcp-keys', label: 'MCP API Keys', icon: KeyRound, requiredTier: 'Professional' },
                { href: '/admin/api-keys', label: 'API Pública', icon: Unlock, requiredTier: 'Professional' },
                { href: '/admin/powerbi-templates', label: 'Power BI Templates', icon: BarChart3, requiredTier: 'Professional' },
                { href: '/admin/focus-export', label: 'FOCUS 1.1 Export', icon: FileSpreadsheet, requiredTier: 'Professional' },
                { href: '/admin/cloud-accounts', label: 'Cloud Accounts (AWS)', icon: Cloud, requiredTier: 'Professional' },
                { href: '/admin/sso', label: 'SSO SAML', icon: ShieldCheck, requiredTier: 'Enterprise' },
                { href: '/admin/data-residency', label: 'Data Residency', icon: Globe, requiredTier: 'Enterprise' }
            ]
        }
    ];

    if (isSuperAdmin(accounts[0]?.username)) {
        categories.find(c => c.id === 'admin')?.items.push({
            href: '/admin/payments',
            label: 'Configuración de Pagos',
            icon: CreditCard
        } as any);
        categories.find(c => c.id === 'admin')?.items.push({
            href: '/admin/tenants',
            label: 'Gestión de Tenants',
            icon: Building2
        } as any);
        categories.find(c => c.id === 'admin')?.items.push({
            href: '/superadmin/funnel',
            label: 'Signup Funnel',
            icon: TrendingUp
        } as any);
    }

    // RBAC logic
    const { userRole } = useTenant();
    const roleCategories = categories.map(cat => {
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
                                    const renderedLink = (
                                        <Link 
                                            key={item.href} 
                                            href={item.href}
                                            title={sidebarOpen ? undefined : item.label}
                                            onClick={(e) => {
                                                if ((item as any).requiredTier && !hasAccess(tier, (item as any).requiredTier)) {
                                                    e.preventDefault();
                                                    return;
                                                }
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

                                    if ((item as any).requiredTier) {
                                        return (
                                            <FeatureGuard key={item.href} requiredTier={(item as any).requiredTier} featureName={item.label}>
                                                {renderedLink}
                                            </FeatureGuard>
                                        );
                                    }
                                    return renderedLink;
                                })}
                            </div>
                        )}
                    </div>
                ))}
            </nav>
        </aside>
    );
}
