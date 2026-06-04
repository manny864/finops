import os
import subprocess
import re

base_dir = "/Users/manuelchavez/Documents/FinOpsProyect"

def run_npm_install():
    print("Installing lucide-react...")
    subprocess.run(["npm", "install", "lucide-react"], cwd=base_dir)

def create_routes():
    print("Creating Next.js routes...")
    routes = [
        ("src/app/intelligence/billing", 'import React from "react";\n\nexport default function BillingPage() {\n  return (\n    <div className="p-6">\n      <h1 className="text-2xl font-bold mb-4">Consumo Real</h1>\n      <p>Dashboard de facturación y distribución de gastos en desarrollo...</p>\n    </div>\n  );\n}\n'),
        ("src/app/intelligence/rightsizing", 'import RightsizingBlade from "@/components/dashboard/RightsizingBlade";\n\nexport default function RightsizingPage() {\n  return (\n    <div className="p-6">\n      <h1 className="text-2xl font-bold mb-4">Rightsizing Engine</h1>\n      <RightsizingBlade />\n    </div>\n  );\n}\n'),
        ("src/app/cleanup/zombies", 'import ZombieResourcesTable from "@/components/ZombieResourcesTable";\n\nexport default function ZombiesPage() {\n  return (\n    <div className="p-6">\n      <h1 className="text-2xl font-bold mb-4 text-gray-900">Auditoría de Recursos Zombis</h1>\n      <p className="text-sm text-gray-500 mb-6">Motor Omni-Scan: Detección y Remediación de 25 tipos de recursos huérfanos.</p>\n      <ZombieResourcesTable />\n    </div>\n  );\n}\n'),
        ("src/app/cleanup/ttl", 'import ExpiredSandboxTable from "@/components/dashboard/ExpiredSandboxTable";\n\nexport default function TtlPage() {\n  return (\n    <div className="p-6">\n      <h1 className="text-2xl font-bold mb-4">Expiraciones TTL</h1>\n      <ExpiredSandboxTable />\n    </div>\n  );\n}\n'),
        ("src/app/governance/tags", 'import TagManager from "@/components/TagManager";\n\nexport default function TagsPage() {\n  return (\n    <div className="p-6">\n      <TagManager />\n    </div>\n  );\n}\n'),
        ("src/app/governance/power", 'import PowerSchedules from "@/components/dashboard/PowerSchedules";\n\nexport default function PowerPage() {\n  return (\n    <div className="p-6">\n      <h1 className="text-2xl font-bold mb-4">Horarios de Apagado</h1>\n      <PowerSchedules />\n    </div>\n  );\n}\n'),
        ("src/app/admin/onboarding", 'import React from "react";\n\nexport default function OnboardingPage() {\n  return (\n    <div className="p-6">\n      <h1 className="text-2xl font-bold mb-4">Onboarding de Clientes</h1>\n      <p>Módulo de configuración de Tenants en construcción...</p>\n    </div>\n  );\n}\n'),
        ("src/app/advisor", 'import AdvisorPanel from "@/components/AdvisorPanel";\n\nexport default function AdvisorPage() {\n  return (\n    <div className="p-6">\n      <AdvisorPanel />\n    </div>\n  );\n}\n'),
    ]

    for route_dir, content in routes:
        full_dir = os.path.join(base_dir, route_dir)
        os.makedirs(full_dir, exist_ok=True)
        with open(os.path.join(full_dir, "page.tsx"), "w") as f:
            f.write(content)

def create_sidebar():
    print("Creating Sidebar.tsx...")
    path = os.path.join(base_dir, "src/components/Sidebar.tsx")
    code = """"use client";
import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { 
    LayoutDashboard, 
    Lightbulb, 
    PieChart, 
    Zap, 
    Trash2, 
    Clock, 
    Tags, 
    Power, 
    Users,
    ChevronDown,
    ChevronRight
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
                { href: '/advisor', label: 'Azure Advisor', icon: Lightbulb }
            ]
        },
        {
            id: 'inteligencia',
            title: 'Inteligencia Financiera',
            items: [
                { href: '/intelligence/billing', label: 'Consumo Real', icon: PieChart },
                { href: '/intelligence/rightsizing', label: 'Rightsizing', icon: Zap }
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
                { href: '/admin/onboarding', label: 'Onboarding Clientes', icon: Users }
            ]
        }
    ];

    return (
        <aside className={`${sidebarOpen ? 'w-64' : 'w-20'} bg-white border-r border-gray-200 transition-all duration-300 flex flex-col shadow-sm h-full`}>
            <div className="h-16 flex items-center justify-center border-b border-gray-200 px-4 shrink-0">
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
                                                    : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
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
"""
    with open(path, "w") as f:
        f.write(code)

def update_clientshell():
    print("Updating ClientShell.tsx...")
    path = os.path.join(base_dir, "src/components/ClientShell.tsx")
    with open(path, "r") as f:
        content = f.read()

    import_sidebar = 'import Sidebar from "./Sidebar";\n'
    if import_sidebar not in content:
        content = content.replace("import AuthSync from './AuthSync';", "import AuthSync from './AuthSync';\n" + import_sidebar)

    aside_pattern = re.compile(r"<aside.*?</aside>", re.DOTALL)
    content = aside_pattern.sub("<Sidebar sidebarOpen={sidebarOpen} />", content)
    
    with open(path, "w") as f:
        f.write(content)

def clean_page_tsx():
    print("Cleaning up page.tsx...")
    path = os.path.join(base_dir, "src/app/page.tsx")
    with open(path, "r") as f:
        content = f.read()
    
    content = content.replace('<PowerSchedules />', '')
    content = content.replace('<RightsizingBlade />', '')
    content = content.replace('<ExpiredSandboxTable />', '')
    
    with open(path, "w") as f:
        f.write(content)

def update_sop():
    print("Writing SOP...")
    path = os.path.join(base_dir, "directivas/app_router_SOP.md")
    with open(path, "w") as f:
        f.write("# App Router Navigation SOP\\n\\n")
        f.write("- **Navegación**: Utiliza `next/link` y `usePathname` en lugar de estados. Sidebar vive en `src/components/Sidebar.tsx`.\\n")
        f.write("- **Iconos**: Usa `lucide-react` para estandarización visual.\\n")

if __name__ == "__main__":
    run_npm_install()
    create_routes()
    create_sidebar()
    update_clientshell()
    clean_page_tsx()
    update_sop()
    print("App Router Migration completada exitosamente.")
