"use client";
import React, { useState, useEffect } from 'react';
import { Link, usePathname } from '@/i18n/routing';
import { useTranslations } from 'next-intl';
import { useTenant } from '@/components/TenantProvider';
import { hasAccess } from '@/lib/tierLogic';
import { getTagsForRoute, hasAnyTag } from '@/lib/pageRoleTags';
import {
    LayoutDashboard,
    Target,
    TrendingDown, 
    Lightbulb, 
    Zap, 
    Trash2, 
    Clock, 
    Tags, 
    Power, 
    Users,
    UsersRound,
    Settings,
    ChevronDown,
    ChevronRight,
    FileText,
    BookOpen,
    Activity,
    CreditCard,
    Cpu,
    Leaf,
    Building2,
    ShieldCheck,
    CheckCircle,
    ShieldAlert,
    BellRing,
    Sparkles,
    Megaphone,
    KeyRound,
    Database,
    BarChart3,
    TrendingUp,
    PiggyBank,
    Network,
    LifeBuoy,
    HeartPulse,
    Boxes,
    Recycle,
    Search,
    X
} from 'lucide-react';
import { IconCoins, IconDatabase } from '@tabler/icons-react';

interface SidebarProps {
    sidebarOpen: boolean;
    setSidebarOpen: (open: boolean) => void;
}

// Links legales del pie. Las claves son las del namespace `Footer` que ya usaba
// PublicFooter — no se duplica copy ni se agregan claves nuevas.
const LEGAL_LINKS = [
    { href: '/legal/privacy', key: 'privacy' },
    { href: '/legal/terms', key: 'terms' },
    { href: '/legal/dpa', key: 'dpa' },
    { href: '/legal/security', key: 'security' },
    { href: '/legal/subprocessors', key: 'subprocessors' },
    { href: '/status', key: 'status' },
] as const;

export default function Sidebar({ sidebarOpen, setSidebarOpen }: SidebarProps) {
    const pathname = usePathname();
    const t = useTranslations('Navigation');
    const tf = useTranslations('Footer');
    // Links legales: antes vivían en un <footer> al pie de cada página, que
    // empujaba el contenido y quedaba siempre visible sin aportar nada al uso
    // diario. Ahora cuelgan de "Powered by" y se despliegan a pedido.
    const [legalOpen, setLegalOpen] = useState(false);
    const { selectedTenant, systemRole: superAdminRole } = useTenant();
    const tier = (selectedTenant as any).tier || 'Professional';
    
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
                { href: '/academy', label: t('academia_finops'), icon: BookOpen },
                { href: '/advisor', label: t('advisor'), icon: Lightbulb },
                { href: '/overview/maturity', label: t('finops_maturity'), icon: Target, requiredTier: 'Professional' },
                { href: '/overview/progress', label: t('historical_progress'), icon: TrendingDown, requiredTier: 'Professional' },
                { href: '/overview/top-expenses', label: t('top_expenses', { fallback: 'TOP Expenses' }), icon: BarChart3, requiredTier: 'Professional' },
                { href: '/overview/resources', label: t('resources', { fallback: 'Recursos' }), icon: Boxes, requiredTier: 'Business' },
                { href: '/overview/sustainability', label: t('green_finops'), icon: Leaf, requiredTier: 'Professional' },
                { href: '/overview/captured-savings', label: t('captured_savings_page', { fallback: 'Ahorro Capturado' }), icon: PiggyBank, requiredTier: 'Professional' },
                { href: '/overview/financial-leaks', label: t('financial_leaks', { fallback: 'Fugas Financieras' }), icon: Recycle, requiredTier: 'Professional' }
            ]
        },
        {
            id: 'inteligencia',
            title: t('inteligencia'),
            items: [
                { href: '/intelligence/consumo-y-presupuesto', label: t('consumo_presupuesto'), icon: IconCoins as any, requiredTier: 'Professional' },
                { href: '/intelligence/optimizacion-y-ahorro', label: t('optimizacion_ahorro'), icon: Target, requiredTier: 'Enterprise' },
                { href: '/intelligence/bases-de-datos', label: t('bases_de_datos'), icon: Database, requiredTier: 'Business' },
                { href: '/intelligence/computo', label: t('computo'), icon: Cpu, requiredTier: 'Business' },
                { href: '/intelligence/almacenamiento', label: t('almacenamiento_nav'), icon: IconDatabase as any, requiredTier: 'Enterprise' },
                { href: '/intelligence/redes', label: t('redes'), icon: Network, requiredTier: 'Business' },
                { href: '/intelligence/licenses', label: t('users_licenses', { fallback: 'Usuarios y Licencias' }), icon: Users, requiredTier: 'Enterprise' },
                { href: '/intelligence/azure-ai', label: t('azure_ai'), icon: Sparkles, requiredTier: 'Enterprise' },
                { href: '/intelligence/integration-services', label: t('integration_services_hub', { fallback: 'Azure Integration Services (iPaaS)' }), icon: Boxes, requiredTier: 'Business' },
                { href: '/intelligence/monitoreo', label: t('monitoring_hub', { fallback: 'Monitoreo' }), icon: Activity, requiredTier: 'Business' },
                { href: '/intelligence/seguridad', label: t('security_hub', { fallback: 'Seguridad' }), icon: ShieldCheck, requiredTier: 'Business' },
                { href: '/intelligence/analitica-avanzada', label: t('advanced_analytics', { fallback: 'Analítica Avanzada' }), icon: BarChart3, requiredTier: 'Business' }
            ]
        },
        {
            id: 'limpieza',
            title: t('cleanup'),
            items: [
                { href: '/cleanup/zombies', label: t('zombie_resources'), icon: Trash2 },
                { href: '/cleanup/zombies/networking', label: t('networking_zombies'), icon: Network, requiredTier: 'Professional' },
                { href: '/cleanup/ttl', label: t('ttl_expirations'), icon: Clock, requiredTier: 'Business' },
                { href: '/cleanup/backup-orphans', label: t('backup_orphans', { fallback: 'Backups Huérfanos' }), icon: ShieldAlert }
            ]
        },
        {
            id: 'gobernanza',
            title: t('governance'),
            items: [
                { href: '/governance/tags', label: t('tag_compliance'), icon: Tags, requiredTier: 'Professional' },
                { href: '/governance/power', label: t('power_schedules'), icon: Power, requiredTier: 'Business' },
                { href: '/governance/policies', label: t('policies_autoblock'), icon: ShieldAlert, requiredTier: 'Enterprise' },
                { href: '/governance/reporting', label: t('governance_reporting', { fallback: 'Reporting de Gobernanza' }), icon: ShieldCheck, requiredTier: 'Enterprise' },
                { href: '/governance/ha', label: t('ha_recommendations', { fallback: 'Alta Disponibilidad' }), icon: ShieldCheck, requiredTier: 'Business' },
                { href: '/governance/credentials', label: t('expiring_credentials', { fallback: 'Credenciales por Expirar' }), icon: KeyRound, requiredTier: 'Business' },
                { href: '/governance/approvals', label: t('approvals'), icon: CheckCircle, requiredTier: 'Business' }
            ]
        },
        {
            id: 'admin',
            title: t('admin'),
            items: [
                { href: '/support', label: t('support', { fallback: 'Soporte' }), icon: LifeBuoy },
                // Agrupadas en hubs con tabs para no saturar el sidebar (ver
                // src/components/admin/AdminHubGate.tsx). Cada tab preserva el
                // gating por rol/permisos que tenía como item independiente; las
                // rutas viejas (/admin/users, /admin/report, etc.) siguen vivas
                // como redirects hacia el tab correspondiente.
                { href: '/admin/access', label: t('usuarios_accesos'), icon: Users },
                { href: '/admin/config', label: t('configuration'), icon: Settings },
                { href: '/admin/reports', label: t('reportes_exportacion'), icon: FileText, requiredTier: 'Professional' },
                { href: '/admin/integrations', label: t('integraciones_api'), icon: Cpu, requiredTier: 'Enterprise' },
                { href: '/admin/account', label: t('facturacion_auditoria'), icon: CreditCard, requiredTier: 'Professional' }
                // Data Residency oculto: hoy sólo tenemos un datacenter (Brasil), ofrecer
                // selección de región (EU/US/LATAM/APAC) sería engañoso. Página y API
                // quedan implementadas para cuando haya despliegue multi-región real.
                // Ver docs/data-residency.md.
            ]
        }
    ];

    // Gate por ROL real (`Users.system_role`, resuelto server-side y expuesto por
    // TenantProvider), no por dominio del email. Antes usaba
    // `isSuperAdmin(accounts[0]?.username)`, que sólo comparaba el dominio: toda
    // cuenta corporativa — Reader y Colaborador incluidos — veía estos módulos.
    if (superAdminRole === 'SUPERADMIN') {
        categories.find(c => c.id === 'admin')?.items.push({
            href: '/superadmin/tenants',
            label: t('gestion_tenants'),
            icon: Building2
        } as any);
        categories.find(c => c.id === 'admin')?.items.push({
            href: '/superadmin/funnel',
            label: t('signup_funnel'),
            icon: TrendingUp
        } as any);
        categories.find(c => c.id === 'admin')?.items.push({
            href: '/superadmin/support',
            label: t('soporte_global'),
            icon: LifeBuoy
        } as any);
        categories.find(c => c.id === 'admin')?.items.push({
            href: '/superadmin/ops',
            label: t('superadmin_ops', { fallback: 'Operaciones SaaS' }),
            icon: HeartPulse
        } as any);
        categories.find(c => c.id === 'admin')?.items.push({
            href: '/superadmin/partner-alerts',
            label: t('superadmin_partner_alerts', { fallback: 'Alertas Partner Center' }),
            icon: BellRing
        } as any);
        categories.find(c => c.id === 'admin')?.items.push({
            href: '/superadmin/affiliates',
            label: t('superadmin_affiliates'),
            icon: UsersRound
        } as any);
        categories.find(c => c.id === 'admin')?.items.push({
            href: '/superadmin/pricing-units',
            label: t('pricing_units'),
            icon: Database
        } as any);
        categories.find(c => c.id === 'admin')?.items.push({
            href: '/superadmin/load-test',
            label: t('prueba_de_carga'),
            icon: Zap
        } as any);
        // "Alertas del Sistema" se quitó: apuntaba a /admin/system-alerts, que
        // renderizaba LoadTestingPanel — el mismo panel que "Prueba de Carga".
        // No existe un panel de alertas; la entrada prometía algo inexistente.
        categories.find(c => c.id === 'admin')?.items.push({
            href: '/superadmin/ai-global-config',
            label: t('ia_config_global'),
            icon: Sparkles
        } as any);
        categories.find(c => c.id === 'admin')?.items.push({
            href: '/superadmin/announcements',
            label: t('superadmin_announcements', { fallback: 'Comunicaciones Globales' }),
            icon: Megaphone
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
    const { userRole, userPermissions, systemRole } = useTenant();
    // Rutas siempre visibles con cualquier combinación de rol/permisos (orientación mínima).
    const ALWAYS_VISIBLE_HREFS = ['/', '/support', '/academy'];
    // Admin/Owner no se acotan por permisos: gestionan la plataforma completa
    // (dentro de lo que el tier permita). Los permisos son opt-in — si el
    // usuario no tiene ninguno asignado, no se aplica ningún recorte adicional
    // por dominio (compatibilidad con tenants que todavía no los asignaron).
    const restrictByPermissions = userPermissions.length > 0 && userRole !== 'Admin' && userRole !== 'Owner';
    const roleCategories = categories.map(cat => {
        let items = cat.items;
        if (systemRole === 'SUPERADMIN') {
            items = items.filter(i => i.href !== '/academy');
        }
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
    const activeHref = React.useMemo(() => {
        const matches = roleCategories
            .flatMap(cat => cat.items.map(i => i.href))
            .filter((href) => href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`))
            .sort((a, b) => b.length - a.length);
        return matches[0] || null;
    }, [pathname, roleCategories]);
    const isRouteActive = (href: string) => href === activeHref;

    return (
        <aside className={`${sidebarOpen ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0 fixed inset-y-0 left-0 z-50 md:relative ${sidebarOpen ? 'w-[252px]' : 'w-[64px]'} bg-gradient-to-b from-[var(--surface-2)] to-[var(--surface)] text-[var(--ink-soft)] border-r border-[var(--line)] transition-all duration-300 flex flex-col h-full custom-scrollbar`}>
            <div className="flex items-center gap-3 p-[18px_18px_14px] shrink-0">
                <div className="flex items-center justify-center overflow-hidden w-full">
                    {sidebarOpen ? (
                        <div className="flex items-center gap-3">
                            <img src="/logo_29k.png" alt="Logo" className="w-[34px] h-[34px] object-contain" />
                            <div className="flex flex-col">
                                <div className="font-heading font-extrabold text-[15px] text-[var(--ink)] tracking-[0.2px] leading-none">CS<b className="text-brand-bright font-extrabold">Cloud</b>Solutions</div>
                                <div className="text-[9.5px] tracking-[2px] text-[var(--ink-soft)] uppercase font-semibold mt-[3px]">Cloud Management Platform</div>
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
                            placeholder={t('searchPlaceholder')}
                            className="w-full pl-8 pr-7 py-1.5 text-xs rounded-lg border border-[var(--line)] bg-[var(--surface)] text-[var(--ink)] placeholder:text-[var(--ink-soft)] focus:outline-none focus:ring-1 focus:ring-brand-bright"
                        />
                        {searchQuery && (
                            <button
                                onClick={() => setSearchQuery('')}
                                className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--ink-soft)] hover:text-[var(--ink)]"
                                aria-label={t('clearSearch')}
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
                            const isActive = isRouteActive(item.href);
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
                                            ? 'sidebar-item-active bg-gradient-to-br from-[#0E1A2B] to-[#1B2A41] text-white shadow-[0_6px_16px_rgba(14,26,43,0.45)]'
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
                                    const isActive = isRouteActive(item.href);
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
                                                    ? 'sidebar-item-active bg-gradient-to-br from-[#0E1A2B] to-[#1B2A41] text-white shadow-[0_6px_16px_rgba(14,26,43,0.45)]'
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

            <div className={`shrink-0 border-t border-[var(--line)] py-3 relative ${sidebarOpen ? 'px-4' : 'px-2'}`}>
                {/* Panel legal. Con el sidebar abierto se despliega hacia arriba
                    en el flujo; colapsado sale como popover a la derecha, para que
                    los links no queden inalcanzables sin abrir el menú. */}
                {legalOpen && (
                    <div
                        className={
                            sidebarOpen
                                ? 'mb-3 flex flex-col gap-1.5'
                                : 'absolute bottom-2 left-full ml-2 z-50 w-52 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3 shadow-lg flex flex-col gap-1.5'
                        }
                    >
                        {LEGAL_LINKS.map(({ href, key }) => (
                            <Link
                                key={href}
                                href={href}
                                onClick={() => setLegalOpen(false)}
                                className="text-[11px] text-[var(--ink-soft)] hover:text-[var(--brand-deep)] transition-colors"
                            >
                                {tf(key)}
                            </Link>
                        ))}
                        <span className="text-[10px] text-[var(--ink-soft)] opacity-70 pt-1 border-t border-[var(--line)] mt-1">
                            {tf('copyright', { year: new Date().getFullYear() })}
                        </span>
                    </div>
                )}

                <button
                    type="button"
                    onClick={() => setLegalOpen((v) => !v)}
                    aria-expanded={legalOpen}
                    title={sidebarOpen ? undefined : 'Powered by CSCloudSolutions'}
                    className={`w-full flex items-center gap-2 text-[var(--ink-soft)] hover:text-[var(--brand-deep)] transition-colors ${sidebarOpen ? 'justify-start' : 'justify-center'}`}
                >
                    <img src="/logo_29k.png" alt="CSCloudSolutions" className="w-4 h-4 object-contain shrink-0 opacity-70" />
                    {sidebarOpen && (
                        <>
                            <span className="text-[10px] font-semibold tracking-[0.5px] truncate">
                                Powered by CSCloudSolutions
                            </span>
                            <ChevronDown
                                className={`w-3 h-3 shrink-0 ml-auto transition-transform ${legalOpen ? 'rotate-180' : ''}`}
                            />
                        </>
                    )}
                </button>
            </div>
        </aside>
    );
}
