"use client";
import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
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
    Activity
} from 'lucide-react';

interface SidebarProps {
    sidebarOpen: boolean;
}

export default function Sidebar({ sidebarOpen }: SidebarProps) {
    const pathname = usePathname();
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
            title: 'Visibilidad',
            items: [
                { href: '/', label: 'Dashboard', icon: LayoutDashboard },
                { href: '/advisor', label: 'Azure Advisor', icon: Lightbulb },
                { href: '/overview/maturity', label: 'Madurez FinOps', icon: Target },
                { href: '/overview/progress', label: 'Progreso Histórico', icon: TrendingDown }
            ]
        },
        {
            id: 'inteligencia',
            title: 'Inteligencia Financiera',
            items: [
                { href: '/intelligence/billing', label: 'Consumo Real', icon: PieChart },
                { href: '/intelligence/rightsizing', label: 'Rightsizing', icon: Zap },
                { href: '/intelligence/network', label: 'Análisis de Red', icon: Activity }
            ]
        },
        {
            id: 'limpieza',
            title: 'Limpieza de Nube',
            items: [
                { href: '/cleanup/zombies', label: 'Recursos Zombis', icon: Trash2 },
                { href: '/cleanup/ttl', label: 'Expiraciones TTL', icon: Clock }
            ]
        },
        {
            id: 'gobernanza',
            title: 'Gobernanza',
            items: [
                { href: '/governance/tags', label: 'Cumplimiento Etiquetas', icon: Tags },
                { href: '/governance/power', label: 'Horarios de Apagado', icon: Power }
            ]
        },
        {
            id: 'admin',
            title: 'Administración',
            items: [
                { href: '/admin/onboarding', label: 'Onboarding Clientes', icon: Users },
                { href: '/admin/config', label: 'Configuración', icon: Settings },
                { href: '/admin/report', label: 'Reporte Ejecutivo', icon: FileText },
                { href: '/admin/workbooks', label: 'Artefactos y Workbooks', icon: BookOpen }
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
