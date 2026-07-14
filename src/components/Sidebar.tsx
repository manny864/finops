"use client";
import React, { useState, useEffect } from 'react';
import { Link, usePathname } from '@/i18n/routing';
import { useTranslations } from 'next-intl';
import { useMsal } from '@azure/msal-react';
import { isSuperAdmin } from '@/lib/authGuard';
import { useTenant } from '@/components/TenantProvider';
import { hasAccess } from '@/lib/tierLogic';
import { getTagsForRoute, hasAnyTag } from '@/lib/pageRoleTags';
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
    TrendingUp,
    PiggyBank,
    Network,
    LifeBuoy,
    HeartPulse,
    Table2,
    Boxes,
    Wallet,
    Recycle,
    Search,
    X
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
    
    // Secciones contraídas por defecto (móvil Y escritorio): el menú muestra
    // solo los títulos de sección; el usuario expande la que necesita. La
    // sección de la página activa se auto-expande (ver useEffect más abajo).
    const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({
        visibilidad: false,
        inteligencia: false,
        limpieza: false,
        gobernanza: false,
        admin: false
    });
    const [searchQuery, setSearchQuery] = useState('');

    const toggleGroup = (group: string) => {
        setOpenGroups(prev => ({ ...prev, [group]: !prev[group] }));
    };

    const categories = [
        {
            id: 'visibilidad',
            title: t('visibilidad'),
            items: [
                { href: '/overview/whiteboard', label: t('white_board', { fallback: 'White Board' }), icon: LayoutDashboard },
                { href: '/academy', label: 'Academia FinOps', icon: BookOpen },
                { href: '/advisor', label: t('advisor'), icon: Lightbulb },
                { href: '/overview/maturity', label: t('finops_maturity'), icon: Target, requiredTier: 'Essential' },
                { href: '/overview/progress', label: t('historical_progress'), icon: TrendingDown, requiredTier: 'Professional' },
                { href: '/overview/top-expenses', label: t('top_expenses', { fallback: 'TOP Expenses' }), icon: BarChart3, requiredTier: 'Professional' },
                { href: '/overview/resources', label: t('resources', { fallback: 'Recursos' }), icon: Boxes, requiredTier: 'Business' },
                { href: '/overview/sustainability', label: 'Green FinOps', icon: Leaf, requiredTier: 'Professional' },
                { href: '/overview/captured-savings', label: t('captured_savings_page', { fallback: 'Ahorro Capturado' }), icon: PiggyBank, requiredTier: 'Professional' },
                { href: '/overview/financial-leaks', label: t('financial_leaks', { fallback: 'Fugas Financieras' }), icon: Recycle, requiredTier: 'Professional' }
            ]
        },
        {
            id: 'inteligencia',
            title: t('inteligencia'),
            items: [
                { href: '/intelligence/billing', label: t('billing'), icon: PieChart, requiredTier: 'Essential' },
                { href: '/intelligence/budgets', label: t('budgets', { fallback: 'Tenant Budgets' }), icon: DollarSign, requiredTier: 'Essential' },
                { href: '/intelligence/cost-groups', label: t('cost_groups', { fallback: 'Cost Groups' }), icon: Table2, requiredTier: 'Business' },
                { href: '/intelligence/cost-centers', label: t('cost_centers', { fallback: 'Presupuesto por Centro de Costos' }), icon: Wallet, requiredTier: 'Enterprise' },
                { href: '/intelligence/rightsizing', label: t('rightsizing'), icon: Zap, requiredTier: 'Enterprise' },
                { href: '/intelligence/network', label: t('network_analytics'), icon: Activity, requiredTier: 'Business' },
                { href: '/intelligence/rates', label: t('rate_optimization'), icon: DollarSign, requiredTier: 'Enterprise' },
                { href: '/intelligence/licenses', label: t('users_licenses', { fallback: 'Usuarios y Licencias' }), icon: Users, requiredTier: 'Enterprise' },
                { href: '/intelligence/hybrid-benefit', label: 'Hybrid Benefit (AHB)', icon: Cpu, requiredTier: 'Business' },
                { href: '/intelligence/commitments', label: 'Reservas (RIs)', icon: ShieldCheck, requiredTier: 'Enterprise' },
                { href: '/intelligence/zero-cost', label: 'Costo Cero', icon: Box },
                { href: '/intelligence/aks', label: 'Control AKS', icon: Server, requiredTier: 'Enterprise' },
                { href: '/intelligence/aks-chargeback', label: 'AKS Chargeback', icon: Layers, requiredTier: 'Enterprise' },
                { href: '/intelligence/unit-economics', label: 'Unit Economics', icon: Activity, requiredTier: 'Enterprise' },
                { href: '/intelligence/allocation', label: 'Prorrateo (Allocation)', icon: PieChart, requiredTier: 'Enterprise' },
                { href: '/intelligence/scorecard', label: 'Scorecard (Fama)', icon: Trophy, requiredTier: 'Business' },
                { href: '/intelligence/anomalies', label: 'Detección Anomalías', icon: ShieldAlert, requiredTier: 'Enterprise' },
                { href: '/intelligence/optimization-index', label: 'Índice de Optimización (COIN)', icon: Target, requiredTier: 'Enterprise' },
                { href: '/intelligence/tenant-health', label: 'Salud del Tenant', icon: HeartPulse, requiredTier: 'Business' },
                { href: '/intelligence/simulator', label: 'Simulador (What-If)', icon: Activity, requiredTier: 'Business' },
                { href: '/intelligence/cost-projection', label: t('cost_projection', { fallback: 'Proyección de Gastos' }), icon: TrendingUp, requiredTier: 'Enterprise' },
                { href: '/intelligence/storage-efficiency', label: t('storage_efficiency', { fallback: 'Eficiencia de Storage' }), icon: HardDrive, requiredTier: 'Enterprise' },
                { href: '/intelligence/cost-by-category', label: t('cost_by_category', { fallback: 'Costo por Categoría' }), icon: PieChart, requiredTier: 'Business' },
                { href: '/intelligence/commitment-simulator', label: t('commitment_simulator', { fallback: 'Savings Plan vs Reserva' }), icon: PiggyBank, requiredTier: 'Professional' },
                { href: '/intelligence/compute-efficiency', label: t('compute_efficiency', { fallback: 'Eficiencia de Cómputo' }), icon: Cpu, requiredTier: 'Enterprise' },
                { href: '/intelligence/alerts', label: t('alerts_self_service', { fallback: 'Alertas (Self-Service)' }), icon: BellRing, requiredTier: 'Business' },
                { href: '/intelligence/ai-analytics', label: t('ai_analytics', { fallback: 'AI Cost Analytics' }), icon: Sparkles, requiredTier: 'Enterprise' },
                { href: '/intelligence/macc', label: t('macc', { fallback: 'MACC Tracking' }), icon: Briefcase, requiredTier: 'Enterprise' },
                { href: '/intelligence/upload', label: 'Ingesta CSV', icon: FileText, requiredTier: 'Business' }
            ]
        },
        {
            id: 'limpieza',
            title: t('cleanup'),
            items: [
                { href: '/cleanup/zombies', label: t('zombie_resources'), icon: Trash2 },
                { href: '/cleanup/zombies/networking', label: 'Networking Zombies', icon: Network, requiredTier: 'Essential' },
                { href: '/cleanup/ttl', label: t('ttl_expirations'), icon: Clock, requiredTier: 'Business' }
            ]
        },
        {
            id: 'gobernanza',
            title: t('governance'),
            items: [
                { href: '/governance/tags', label: t('tag_compliance'), icon: Tags, requiredTier: 'Essential' },
                { href: '/governance/power', label: t('power_schedules'), icon: Power, requiredTier: 'Business' },
                { href: '/governance/policies', label: 'Políticas (Auto-Block)', icon: ShieldAlert, requiredTier: 'Enterprise' },
                { href: '/governance/reporting', label: t('governance_reporting', { fallback: 'Reporting de Gobernanza' }), icon: ShieldCheck, requiredTier: 'Enterprise' },
                { href: '/governance/ha', label: t('ha_recommendations', { fallback: 'Alta Disponibilidad' }), icon: ShieldCheck, requiredTier: 'Business' },
                { href: '/governance/credentials', label: t('expiring_credentials', { fallback: 'Credenciales por Expirar' }), icon: KeyRound, requiredTier: 'Business' },
                { href: '/remediation/approvals', label: 'Aprobaciones', icon: CheckCircle, requiredTier: 'Business' }
            ]
        },
        {
            id: 'admin',
            title: t('admin'),
            items: [
                { href: '/support', label: t('support', { fallback: 'Soporte' }), icon: LifeBuoy },
                { href: '/admin/users', label: 'Usuarios y Permisos', icon: Users },
                { href: '/admin/onboarding', label: t('client_onboarding'), icon: Users },
                { href: '/admin/onboarding/lighthouse', label: 'Azure Lighthouse Onboarding', icon: Network, requiredTier: 'Enterprise' },
                { href: '/admin/config', label: t('configuration'), icon: Settings },
                { href: '/admin/markup', label: 'Partner Markup (CSP)', icon: DollarSign, requiredTier: 'Enterprise' },
                { href: '/admin/ai-config', label: 'Configuración de IA', icon: Cpu, requiredTier: 'Professional' },
                { href: '/admin/report', label: t('executive_report'), icon: FileText, requiredTier: 'Business' },
                { href: '/admin/workbooks', label: t('workbooks'), icon: BookOpen, requiredTier: 'Enterprise' },
                { href: '/admin/notifications', label: 'Notificaciones', icon: Bell, requiredTier: 'Professional' },
                { href: '/admin/billing', label: 'Facturación', icon: CreditCard, requiredTier: 'Essential' },
                { href: '/admin/copilot-m365', label: t('copilot_m365', { fallback: 'Copilot M365' }), icon: Bot, requiredTier: 'Enterprise' },
                { href: '/admin/audit', label: t('audit_trail'), icon: Activity, requiredTier: 'Professional' },
                { href: '/admin/mcp-keys', label: 'MCP API Keys', icon: KeyRound, requiredTier: 'Enterprise' },
                { href: '/admin/api-keys', label: 'API Pública', icon: Unlock, requiredTier: 'Enterprise' },
                { href: '/admin/powerbi-templates', label: 'Power BI Templates', icon: BarChart3, requiredTier: 'Enterprise' },
                { href: '/admin/focus-export', label: 'FOCUS 1.1 Export', icon: FileSpreadsheet, requiredTier: 'Professional' },
                // Cloud Accounts (AWS) oculto: no hacemos referencia a AWS por ahora (2026-07-05).
                // Página y API quedan implementadas, sin uso, para cuando se retome soporte AWS.
                { href: '/admin/sso', label: 'SSO SAML', icon: ShieldCheck, requiredTier: 'Enterprise' }
                // Data Residency oculto: hoy sólo tenemos un datacenter (Brasil), ofrecer
                // selección de región (EU/US/LATAM/APAC) sería engañoso. Página y API
                // quedan implementadas para cuando haya despliegue multi-región real.
                // Ver docs/data-residency.md.
            ]
        }
    ];

    if (isSuperAdmin(accounts[0]?.username)) {
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
        categories.find(c => c.id === 'admin')?.items.push({
            href: '/superadmin/support',
            label: 'Soporte (Global)',
            icon: LifeBuoy
        } as any);
        categories.find(c => c.id === 'admin')?.items.push({
            href: '/admin/pricing-units',
            label: 'Pricing Units',
            icon: Database
        } as any);
        categories.find(c => c.id === 'admin')?.items.push({
            href: '/admin/load-test',
            label: 'Prueba de Carga',
            icon: Zap
        } as any);
        categories.find(c => c.id === 'admin')?.items.push({
            href: '/admin/system-alerts',
            label: 'Alertas del Sistema',
            icon: ShieldAlert
        } as any);
        categories.find(c => c.id === 'admin')?.items.push({
            href: '/admin/ai-config-global',
            label: 'IA — Configuración Global',
            icon: Sparkles
        } as any);
    }

    // Auto-expandir solo la sección que contiene la página activa; el resto
    // permanece contraído.
    useEffect(() => {
        const active = categories.find(c =>
            c.items.some(i => i.href === '/' ? pathname === '/' : pathname.startsWith(i.href))
        );
        if (active) {
            setOpenGroups(prev => prev[active.id] ? prev : { ...prev, [active.id]: true });
        }
        // categories se reconstruye en cada render; alcanza con reaccionar a la ruta.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pathname]);

    // RBAC logic. `role` (Reader/Colaborador/Admin/Owner) = CAPACIDAD: qué
    // acciones puede ejecutar. `permissions` (FinOps/CloudAdmin/Security/
    // ProductOwner) = DOMINIO: qué páginas puede ver — son independientes y
    // se aplican JUNTAS, no una en lugar de la otra. Un usuario puede ser
    // Reader (solo lectura) + permiso FinOps (solo ve páginas de ese dominio).
    const { userRole, userPermissions } = useTenant();
    // Rutas siempre visibles con cualquier combinación de rol/permisos (orientación mínima).
    const ALWAYS_VISIBLE_HREFS = ['/', '/support', '/academy'];
    // Admin/Owner no se acotan por permisos: gestionan la plataforma completa
    // (dentro de lo que el tier permita). Los permisos son opt-in — si el
    // usuario no tiene ninguno asignado, no se aplica ningún recorte adicional
    // por dominio (compatibilidad con tenants que todavía no los asignaron).
    const restrictByPermissions = userPermissions.length > 0 && userRole !== 'Admin' && userRole !== 'Owner';
    const roleCategories = categories.map(cat => {
        let items = cat.items;
        if (restrictByPermissions) {
            items = items.filter(i => ALWAYS_VISIBLE_HREFS.includes(i.href) || hasAnyTag(userPermissions, getTagsForRoute(i.href)));
            if (items.length === 0) return null;
        }
        if (userRole === 'Reader') {
            // Readers can only see visibility, and maybe reports
            if (cat.id === 'limpieza' || cat.id === 'gobernanza') return null;
            if (cat.id === 'admin') return { ...cat, items: items.filter(i => i.href.includes('report')) };
            return { ...cat, items };
        }
        if (userRole === 'Colaborador') {
            // Colaborador can't see users, config, billing
            if (cat.id === 'admin') return { ...cat, items: items.filter(i => !i.href.includes('users') && !i.href.includes('config') && !i.href.includes('pricing-units')) };
            return { ...cat, items };
        }
        return { ...cat, items }; // Admin sees what the tier allows
    }).filter(Boolean) as typeof categories;

    // Buscador de páginas: filtra por label (normalizado, sin acentos) sobre
    // los items ya resueltos por rol/tier (roleCategories) — nunca expone una
    // página que el usuario no vería igual navegando por las categorías.
    const normalize = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const searchResults = searchQuery.trim()
        ? roleCategories.flatMap(cat => cat.items
            .filter(i => normalize(i.label).includes(normalize(searchQuery.trim())))
            .map(i => ({ ...i, categoryTitle: cat.title })))
        : [];

    return (
        <aside className={`${sidebarOpen ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0 fixed inset-y-0 left-0 z-50 md:relative ${sidebarOpen ? 'w-[252px]' : 'w-[64px]'} bg-gradient-to-b from-[var(--surface-2)] to-[var(--surface)] text-[var(--ink-soft)] border-r border-[var(--line)] transition-all duration-300 flex flex-col h-full custom-scrollbar`}>
            <div className="flex items-center gap-3 p-[18px_18px_14px] shrink-0">
                <div className="flex items-center justify-center overflow-hidden w-full">
                    {sidebarOpen ? (
                        <div className="flex items-center gap-3">
                            <img src="/logo_29k.png" alt="Logo" className="w-[34px] h-[34px] object-contain" />
                            <div className="flex flex-col">
                                <div className="font-heading font-extrabold text-[15px] text-[var(--ink)] tracking-[0.2px] leading-none">CS<b className="text-brand-bright font-extrabold">Cloud</b>Solutions</div>
                                <div className="text-[9.5px] tracking-[2px] text-[var(--ink-soft)] uppercase font-semibold mt-[3px]">FinOps Platform</div>
                            </div>
                        </div>
                    ) : (
                        <img src="/logo_29k.png" alt="Logo" className="w-[34px] h-[34px] object-contain" />
                    )}
                </div>
            </div>

            {sidebarOpen && (
                <div className="px-3 pb-2 shrink-0">
                    <div className="relative">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--ink-soft)] pointer-events-none" />
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Buscar páginas..."
                            className="w-full pl-8 pr-7 py-1.5 text-xs rounded-lg border border-[var(--line)] bg-[var(--surface)] text-[var(--ink)] placeholder:text-[var(--ink-soft)] focus:outline-none focus:ring-1 focus:ring-brand-bright"
                        />
                        {searchQuery && (
                            <button
                                onClick={() => setSearchQuery('')}
                                className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--ink-soft)] hover:text-[var(--ink)]"
                                aria-label="Limpiar búsqueda"
                            >
                                <X className="w-3.5 h-3.5" />
                            </button>
                        )}
                    </div>
                </div>
            )}

            <nav className="flex-1 py-4 px-2 space-y-4 overflow-y-auto overflow-x-hidden">
                {searchQuery.trim() ? (
                    <div className="space-y-1">
                        {searchResults.length === 0 ? (
                            <p className="px-3 py-2 text-xs text-[var(--ink-soft)]">Sin resultados para &quot;{searchQuery}&quot;.</p>
                        ) : searchResults.map(item => {
                            const Icon = item.icon;
                            const isActive = pathname === item.href;
                            // Mismo criterio que en roleCategories.map: navega igual, el
                            // mensaje de plan lo muestra RouteTierGate en la página destino.
                            const isLocked = (item as any).requiredTier && !hasAccess(tier, (item as any).requiredTier);
                            return (
                                <Link
                                    key={item.href}
                                    href={item.href}
                                    onClick={() => {
                                        setSearchQuery('');
                                        if (window.innerWidth <= 768) setSidebarOpen(false);
                                    }}
                                    className={`w-full flex items-center px-[11px] py-[9px] rounded-[10px] font-semibold transition-all duration-200 text-[13.5px] mb-1 ${
                                        isActive
                                            ? 'bg-gradient-to-br from-brand-deep to-[#1E88E5] text-white shadow-[0_6px_16px_rgba(0,84,166,0.4)]'
                                            : 'text-[var(--ink-soft)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]'
                                    } ${isLocked ? 'opacity-40 grayscale' : ''}`}
                                >
                                    <Icon className="flex-shrink-0 w-5 h-5 mr-3" />
                                    <span className="text-sm truncate flex-1">
                                        {item.label}
                                        <span className="block text-[10px] font-normal opacity-70 truncate">{item.categoryTitle}</span>
                                    </span>
                                </Link>
                            );
                        })}
                    </div>
                ) : roleCategories.map(category => (
                    <div key={category.id} className="flex flex-col">
                        {sidebarOpen ? (
                            <button 
                                onClick={() => toggleGroup(category.id)}
                                className="flex items-center justify-between px-3 py-2 w-full text-left focus:outline-none group"
                            >
                                <span className="text-[10px] font-bold text-[var(--ink-soft)] uppercase tracking-[1.6px] group-hover:text-[var(--ink)] transition-colors">
                                    {category.title}
                                </span>
                                {openGroups[category.id] ?
                                    <ChevronDown className="w-4 h-4 text-[var(--ink-soft)] group-hover:text-[var(--ink)]" /> :
                                    <ChevronRight className="w-4 h-4 text-[var(--ink-soft)] group-hover:text-[var(--ink)]" />
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
                                    // Las etiquetas de rol (pageRoleTags.ts) son internas: se usan para
                                    // filtrar la navegación por rol (ver roleCategories más abajo), pero
                                    // no se muestran como badge — el usuario pidió que no sean visibles.
                                    // Los items bloqueados por tier SÍ navegan: el mensaje de
                                    // "Función no disponible en tu plan" lo muestra RouteTierGate
                                    // en la vista de página (a la derecha del sidebar), no un modal
                                    // acá — por eso no usamos FeatureGuard (que es modal-click,
                                    // pensado para tarjetas sueltas dentro de una página, no para
                                    // rutas de navegación reales). Solo aplicamos el estilo
                                    // blureado/sin-candado para dar la misma pista visual.
                                    const isLocked = (item as any).requiredTier && !hasAccess(tier, (item as any).requiredTier);
                                    const renderedLink = (
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
                                                    : 'text-[var(--ink-soft)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]'
                                            } ${isLocked ? 'opacity-40 grayscale' : ''}`}
                                        >
                                            <Icon className={`flex-shrink-0 ${sidebarOpen ? 'w-5 h-5 mr-3' : 'w-6 h-6 mx-auto'}`} />
                                            {sidebarOpen && <span className="text-sm truncate flex-1 md:block">{item.label}</span>}
                                        </Link>
                                    );
                                    return renderedLink;
                                })}
                            </div>
                        )}
                    </div>
                ))}
            </nav>

            <div className={`shrink-0 border-t border-[var(--line)] py-3 ${sidebarOpen ? 'px-4' : 'px-2'}`}>
                <div className={`flex items-center gap-2 text-[var(--ink-soft)] ${sidebarOpen ? 'justify-start' : 'justify-center'}`}>
                    <img src="/logo_29k.png" alt="CS Cloud Solutions" className="w-4 h-4 object-contain shrink-0 opacity-70" />
                    {sidebarOpen && (
                        <span className="text-[10px] font-semibold tracking-[0.5px] truncate">
                            Powered by CSCloudSolutions
                        </span>
                    )}
                </div>
            </div>
        </aside>
    );
}
