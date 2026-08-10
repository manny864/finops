import os
import json

base_dir = "/Users/manuelchavez/Documents/FinOpsProyect"

def patch_file(filepath, search_str, replace_str):
    print(f"Parcheando {filepath}...")
    with open(filepath, "r", encoding="utf-8") as f:
        content = f.read()
    if search_str not in content:
        print(f"Advertencia: '{search_str}' no encontrado en {filepath}")
        return False
    content = content.replace(search_str, replace_str)
    with open(filepath, "w", encoding="utf-8") as f:
        f.write(content)
    print(f"Modificado exitosamente: {filepath}")
    return True

def patch_json_i18n(filepath, lang):
    print(f"Parcheando JSON de traducción {filepath}...")
    with open(filepath, "r", encoding="utf-8") as f:
        data = json.load(f)

    # 1. Agregar tabSentinel a MonitoringHub
    if "MonitoringHub" in data:
        data["MonitoringHub"]["tabSentinel"] = "Microsoft Sentinel"
    else:
        print(f"Advertencia: 'MonitoringHub' no encontrado en {filepath}")

    # 2. Agregar sentinelTitle y sentinelSubtitle a MonitoringFamilies
    if "MonitoringFamilies" in data:
        data["MonitoringFamilies"]["sentinelTitle"] = "Microsoft Sentinel"
        if lang == "es":
            data["MonitoringFamilies"]["sentinelSubtitle"] = "Inventario y costo mensual de Microsoft Sentinel en el espacio de trabajo."
        elif lang == "en":
            data["MonitoringFamilies"]["sentinelSubtitle"] = "Inventory and monthly cost of Microsoft Sentinel in the workspace."
        elif lang == "pt-BR":
            data["MonitoringFamilies"]["sentinelSubtitle"] = "Inventário e custo mensal do Microsoft Sentinel no espaço de trabalho."
    else:
        print(f"Advertencia: 'MonitoringFamilies' no encontrado en {filepath}")

    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"Traducciones JSON guardadas para {filepath}")

def deploy():
    # 1. Modificar API: route.ts
    api_path = os.path.join(base_dir, "src/app/api/intelligence/monitoring/service-cost/route.ts")
    
    # Parchear tipo Family
    patch_file(
        api_path,
        'type Family = "azure-monitor" | "action-groups" | "workbooks" | "network-watcher";',
        'type Family = "azure-monitor" | "action-groups" | "workbooks" | "network-watcher" | "microsoft-sentinel";'
    )
    
    # Parchear FAMILY_META
    search_meta = """    "network-watcher": {
        serviceNames: ["Network Watcher"],
        argTypeFilter: "type =~ 'microsoft.network/networkwatchers'",
        label: "Network Watcher",
    },
};"""
    
    replace_meta = """    "network-watcher": {
        serviceNames: ["Network Watcher"],
        argTypeFilter: "type =~ 'microsoft.network/networkwatchers'",
        label: "Network Watcher",
    },
    "microsoft-sentinel": {
        serviceNames: ["Microsoft Sentinel", "Azure Monitor"],
        argTypeFilter: "type =~ 'microsoft.operationalinsights/workspaces'",
        label: "Microsoft Sentinel",
    },
};"""
    patch_file(api_path, search_meta, replace_meta)
    
    # Parchear mocks
    search_mocks = """                    const mockMap: Record<Family, number> = {
                        "azure-monitor": 341.2,
                        "action-groups": 0,
                        workbooks: 19.4,
                        "network-watcher": 37.8,
                    };
                    const resourceCountMap: Record<Family, number> = {
                        "azure-monitor": 12,
                        "action-groups": 5,
                        workbooks: 4,
                        "network-watcher": 2,
                    };"""
                    
    replace_mocks = """                    const mockMap: Record<Family, number> = {
                        "azure-monitor": 341.2,
                        "action-groups": 0,
                        workbooks: 19.4,
                        "network-watcher": 37.8,
                        "microsoft-sentinel": 186.6,
                    };
                    const resourceCountMap: Record<Family, number> = {
                        "azure-monitor": 12,
                        "action-groups": 5,
                        workbooks: 4,
                        "network-watcher": 2,
                        "microsoft-sentinel": 2,
                    };"""
    patch_file(api_path, search_mocks, replace_mocks)

    # 2. Modificar componente de Dashboard: MonitoringServiceCostBoard.tsx
    board_path = os.path.join(base_dir, "src/components/dashboard/MonitoringServiceCostBoard.tsx")
    patch_file(
        board_path,
        'type Family = "azure-monitor" | "action-groups" | "workbooks" | "network-watcher";',
        'type Family = "azure-monitor" | "action-groups" | "workbooks" | "network-watcher" | "microsoft-sentinel";'
    )

    # 3. Modificar layout de Monitoreo: layout.tsx
    layout_path = os.path.join(base_dir, "src/app/[locale]/intelligence/monitoreo/layout.tsx")
    patch_file(
        layout_path,
        'import { Activity, Eye, Database, Bell, BellRing, BookOpen, Radar } from "lucide-react";',
        'import { Activity, Eye, Database, Bell, BellRing, BookOpen, Radar, Shield } from "lucide-react";'
    )
    
    search_tabs = """        { href: "/intelligence/monitoreo/azure-monitor", label: t("tabAzureMonitor"), icon: <Activity className="w-4 h-4 text-[#0054A6]" /> },"""
    replace_tabs = """        { href: "/intelligence/monitoreo/azure-monitor", label: t("tabAzureMonitor"), icon: <Activity className="w-4 h-4 text-[#0054A6]" /> },
        { href: "/intelligence/monitoreo/microsoft-sentinel", label: t("tabSentinel"), icon: <Shield className="w-4 h-4 text-[#0054A6]" /> },"""
    patch_file(layout_path, search_tabs, replace_tabs)

    # 4. Crear página microsoft-sentinel/page.tsx
    page_dir = os.path.join(base_dir, "src/app/[locale]/intelligence/monitoreo/microsoft-sentinel")
    os.makedirs(page_dir, exist_ok=True)
    page_path = os.path.join(page_dir, "page.tsx")
    page_content = """import MonitoringServiceCostBoard from "@/components/dashboard/MonitoringServiceCostBoard";
import { getTranslations } from "next-intl/server";
import { Shield } from "lucide-react";

export default async function MicrosoftSentinelPage() {
    const t = await getTranslations("MonitoringFamilies");
    return (
        <MonitoringServiceCostBoard
            family="microsoft-sentinel"
            title={t("sentinelTitle")}
            subtitle={t("sentinelSubtitle")}
            icon={<Shield className="w-7 h-7 text-[#0054A6]" />}
        />
    );
}
"""
    with open(page_path, "w", encoding="utf-8") as f:
        f.write(page_content)
    print(f"Página creada en {page_path}")

    # 5. Parchear JSON de traducciones
    patch_json_i18n(os.path.join(base_dir, "messages/es.json"), "es")
    patch_json_i18n(os.path.join(base_dir, "messages/en.json"), "en")
    patch_json_i18n(os.path.join(base_dir, "messages/pt-BR.json"), "pt-BR")

    print("--- Proceso de parche completado con éxito ---")

if __name__ == "__main__":
    deploy()
