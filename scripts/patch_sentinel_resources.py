import os
import json

base_dir = "/Users/manuelchavez/Documents/FinOpsProyect"

def patch_file(filepath, search_str, replace_str):
    print(f"Parcheando {filepath}...")
    with open(filepath, "r", encoding="utf-8") as f:
        content = f.read()
    if search_str not in content:
        print(f"Error: '{search_str}' no encontrado en {filepath}")
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

    if "MonitoringFamilies" in data:
        if lang == "es":
            data["MonitoringFamilies"]["colResourceName"] = "Recurso / Grupo de Recursos"
            data["MonitoringFamilies"]["colSubscription"] = "Suscripción"
            data["MonitoringFamilies"]["colResource"] = "Recurso"
        elif lang == "en":
            data["MonitoringFamilies"]["colResourceName"] = "Resource / Resource Group"
            data["MonitoringFamilies"]["colSubscription"] = "Subscription"
            data["MonitoringFamilies"]["colResource"] = "Resource"
        elif lang == "pt-BR":
            data["MonitoringFamilies"]["colResourceName"] = "Recurso / Grupo de Recursos"
            data["MonitoringFamilies"]["colSubscription"] = "Assinatura"
            data["MonitoringFamilies"]["colResource"] = "Recurso"
    else:
        print(f"Advertencia: 'MonitoringFamilies' no encontrado en {filepath}")

    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"Traducciones JSON actualizadas para {filepath}")

def deploy():
    # 1. Modificar API: route.ts
    api_path = os.path.join(base_dir, "src/app/api/intelligence/monitoring/service-cost/route.ts")
    
    # Reemplazar mock logic
    search_mock = """                if (isMockTenant(tenantId)) {
                    const mockMap: Record<Family, number> = {
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
                    };
                    return {
                        success: true,
                        mock: true,
                        family,
                        serviceLabel: FAMILY_META[family].label,
                        resourceCount: resourceCountMap[family],
                        monthlyCost: mockMap[family],
                        dataAvailable: true,
                    };
                }"""
                
    replace_mock = """                if (isMockTenant(tenantId)) {
                    const mockResourcesMap: Record<Family, Array<{ name: string; resourceGroup: string; subscriptionId: string; monthlyCost: number }>> = {
                        "azure-monitor": [
                            { name: "law-prod-central", resourceGroup: "rg-monitoring", subscriptionId: "mock-sub", monthlyCost: 180.0 },
                            { name: "law-network-diag", resourceGroup: "rg-network", subscriptionId: "mock-sub", monthlyCost: 95.0 },
                            { name: "law-security", resourceGroup: "rg-security", subscriptionId: "mock-sub", monthlyCost: 50.0 },
                            { name: "law-apps-dev", resourceGroup: "rg-dev", subscriptionId: "mock-sub", monthlyCost: 16.2 }
                        ],
                        "action-groups": [
                            { name: "ag-email-alerts", resourceGroup: "rg-monitoring", subscriptionId: "mock-sub", monthlyCost: 0 },
                            { name: "ag-sms-critical", resourceGroup: "rg-monitoring", subscriptionId: "mock-sub", monthlyCost: 0 }
                        ],
                        workbooks: [
                            { name: "wb-finops-dashboard", resourceGroup: "rg-monitoring", subscriptionId: "mock-sub", monthlyCost: 12.4 },
                            { name: "wb-security-audit", resourceGroup: "rg-security", subscriptionId: "mock-sub", monthlyCost: 7.0 }
                        ],
                        "network-watcher": [
                            { name: "nw-eastus", resourceGroup: "NetworkWatcherRG", subscriptionId: "mock-sub", monthlyCost: 25.0 },
                            { name: "nw-westeurope", resourceGroup: "NetworkWatcherRG", subscriptionId: "mock-sub", monthlyCost: 12.8 }
                        ],
                        "microsoft-sentinel": [
                            { name: "sentinel-workspace-prod", resourceGroup: "rg-security", subscriptionId: "mock-sub", monthlyCost: 124.20 },
                            { name: "sentinel-workspace-shared", resourceGroup: "rg-monitoring", subscriptionId: "mock-sub", monthlyCost: 62.40 }
                        ]
                    };
                    const resources = mockResourcesMap[family] || [];
                    const monthlyCost = resources.reduce((acc, r) => acc + r.monthlyCost, 0);
                    return {
                        success: true,
                        mock: true,
                        family,
                        serviceLabel: FAMILY_META[family].label,
                        resourceCount: resources.length,
                        monthlyCost: Number(monthlyCost.toFixed(2)),
                        resources,
                        dataAvailable: true,
                    };
                }"""
    patch_file(api_path, search_mock, replace_mock)

    # Reemplazar lógica real de consulta de Resource Graph y Cost Management
    search_real = """                let resourceCount = 0;
                try {
                    const arg = await getResourceGraphClient(tenantId);
                    const q = `Resources | where ${FAMILY_META[family].argTypeFilter} | summarize resourceCount = count()`;
                    const argRes: any = await arg.resources({ query: q, options: { resultFormat: "objectArray", top: 1 } });
                    resourceCount = Number((argRes.data as any[])?.[0]?.resourceCount || 0);
                } catch {
                    resourceCount = 0;
                }

                if (subs.length === 0) {
                    return { success: true, mock: false, family, serviceLabel: FAMILY_META[family].label, resourceCount, monthlyCost: 0, dataAvailable: true };
                }

                let monthlyCost = 0;
                let dataAvailable = true;
                for (const subId of subs) {
                    const cm = new CostManagementClient(credential);
                    const scope = `/subscriptions/${subId}`;
                    const now = new Date();
                    const from = new Date();
                    from.setDate(now.getDate() - 30);
                    try {
                        const result = await withCostColumn(tenantId, (col) =>
                            cm.query.usage(scope, {
                                type: "ActualCost",
                                timeframe: "Custom",
                                timePeriod: { from, to: now },
                                dataset: {
                                    granularity: "None",
                                    aggregation: { totalCost: { name: col, function: "Sum" } },
                                    grouping: [{ type: "Dimension", name: "ServiceName" }],
                                    filter: { dimensions: { name: "ServiceName", operator: "In", values: FAMILY_META[family].serviceNames } },
                                },
                            } as any)
                        );
                        const cols = result.columns || [];
                        const costIdx = findCostColumnIndex(cols as any);
                        for (const row of result.rows || []) {
                            monthlyCost += Number(row[costIdx >= 0 ? costIdx : 0] || 0);
                        }
                    } catch {
                        dataAvailable = false;
                    }
                }

                return {
                    success: true,
                    mock: false,
                    family,
                    serviceLabel: FAMILY_META[family].label,
                    resourceCount,
                    monthlyCost: Number(monthlyCost.toFixed(2)),
                    dataAvailable,
                };"""

    replace_real = """                let resources: any[] = [];
                try {
                    const arg = await getResourceGraphClient(tenantId);
                    const q = `Resources | where ${FAMILY_META[family].argTypeFilter} | project name, resourceGroup, subscriptionId, id = tolower(id)`;
                    const argRes: any = await arg.resources({ query: q, options: { resultFormat: "objectArray", top: 1000 } });
                    resources = (argRes.data as any[]) || [];
                } catch {
                    resources = [];
                }

                if (subs.length === 0) {
                    return { success: true, mock: false, family, serviceLabel: FAMILY_META[family].label, resourceCount: resources.length, monthlyCost: 0, resources: [], dataAvailable: true };
                }

                let monthlyCost = 0;
                let dataAvailable = true;
                const costByResourceId: Record<string, number> = {};
                for (const subId of subs) {
                    const cm = new CostManagementClient(credential);
                    const scope = `/subscriptions/${subId}`;
                    const now = new Date();
                    const from = new Date();
                    from.setDate(now.getDate() - 30);
                    try {
                        const result = await withCostColumn(tenantId, (col) =>
                            cm.query.usage(scope, {
                                type: "ActualCost",
                                timeframe: "Custom",
                                timePeriod: { from, to: now },
                                dataset: {
                                    granularity: "None",
                                    aggregation: { totalCost: { name: col, function: "Sum" } },
                                    grouping: [{ type: "Dimension", name: "ResourceId" }],
                                    filter: { dimensions: { name: "ServiceName", operator: "In", values: FAMILY_META[family].serviceNames } },
                                },
                            } as any)
                        );
                        const cols = result.columns || [];
                        const costIdx = findCostColumnIndex(cols as any);
                        const ridIdx = cols.map((c: any) => String(c.name).toLowerCase()).indexOf("resourceid");
                        for (const row of result.rows || []) {
                            const rid = ridIdx >= 0 ? String(row[ridIdx]).toLowerCase() : "";
                            const cost = costIdx >= 0 ? Number(row[costIdx] || 0) : 0;
                            if (rid) {
                                costByResourceId[rid] = (costByResourceId[rid] || 0) + cost;
                            }
                        }
                    } catch {
                        dataAvailable = false;
                    }
                }

                const mappedResources = resources.map((r) => {
                    const cost = costByResourceId[r.id] || 0;
                    monthlyCost += cost;
                    return {
                        name: r.name,
                        resourceGroup: r.resourceGroup,
                        subscriptionId: r.subscriptionId,
                        monthlyCost: Number(cost.toFixed(2)),
                    };
                }).sort((a, b) => b.monthlyCost - a.monthlyCost);

                return {
                    success: true,
                    mock: false,
                    family,
                    serviceLabel: FAMILY_META[family].label,
                    resourceCount: mappedResources.length,
                    monthlyCost: Number(monthlyCost.toFixed(2)),
                    resources: mappedResources,
                    dataAvailable,
                };"""
    patch_file(api_path, search_real, replace_real)

    # 2. Modificar MonitoringServiceCostBoard.tsx
    board_path = os.path.join(base_dir, "src/components/dashboard/MonitoringServiceCostBoard.tsx")
    
    # Parchear imports
    patch_file(
        board_path,
        'import { DollarSign, Layers } from "lucide-react";',
        'import { DollarSign, Layers } from "lucide-react";\nimport Pagination, { usePagination } from "@/components/Pagination";'
    )
    
    # Parchear lógica del componente (antes del return)
    search_logic = """    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();
    const [loading, setLoading] = useState(true);
    const [data, setData] = useState<any>(null);"""
    
    replace_logic = """    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();
    const [loading, setLoading] = useState(true);
    const [data, setData] = useState<any>(null);
    
    const hasResources = Array.isArray(data?.resources) && data.resources.length > 0;
    const { page, setPage, pageSize, setPageSize, total, totalPages, paged } = usePagination(data?.resources || []);"""
    patch_file(board_path, search_logic, replace_logic)

    # Parchear la tabla de render
    search_table = """            <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 p-6">
                <h3 className="text-lg font-bold text-gray-900 dark:text-white border-b border-gray-100 dark:border-slate-800 pb-3 mb-4">{t("tableTitle")}</h3>
                <table className="w-full text-left border-collapse">
                    <thead>
                        <tr>
                            <th className="py-3 px-4 border-b border-gray-200 dark:border-slate-700 font-bold text-xs text-gray-500 uppercase">{t("colService")}</th>
                            <th className="py-3 px-4 border-b border-gray-200 dark:border-slate-700 font-bold text-xs text-gray-500 uppercase text-right">{t("colResources")}</th>
                            <th className="py-3 px-4 border-b border-gray-200 dark:border-slate-700 font-bold text-xs text-gray-500 uppercase text-right">{t("colMonthlyCost")}</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td className="py-3 px-4 border-b border-gray-100 dark:border-slate-800 font-semibold text-sm text-gray-800 dark:text-gray-200">{data?.serviceLabel || title}</td>
                            <td className="py-3 px-4 border-b border-gray-100 dark:border-slate-800 text-sm text-right">{Number(data?.resourceCount || 0)}</td>
                            <td className="py-3 px-4 border-b border-gray-100 dark:border-slate-800 font-bold text-sm text-brand-deep text-right">{fmt.format(data?.monthlyCost || 0)}</td>
                        </tr>
                    </tbody>
                </table>
            </div>"""

    replace_table = """            <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 p-6">
                <h3 className="text-lg font-bold text-gray-900 dark:text-white border-b border-gray-100 dark:border-slate-800 pb-3 mb-4">{t("tableTitle")}</h3>
                {hasResources ? (
                    <>
                        <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse">
                                <thead>
                                    <tr>
                                        <th className="py-3 px-4 border-b border-gray-200 dark:border-slate-700 font-bold text-xs text-gray-500 uppercase">{t("colResourceName")}</th>
                                        <th className="py-3 px-4 border-b border-gray-200 dark:border-slate-700 font-bold text-xs text-gray-500 uppercase">{t("colSubscription")}</th>
                                        <th className="py-3 px-4 border-b border-gray-200 dark:border-slate-700 font-bold text-xs text-gray-500 uppercase text-right">{t("colMonthlyCost")}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {paged.map((res: any, idx: number) => (
                                        <tr key={idx} className="hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors">
                                            <td className="py-3 px-4 border-b border-gray-100 dark:border-slate-800 font-semibold text-sm text-gray-800 dark:text-gray-200">
                                                {res.name}
                                                <span className="block text-[11px] text-gray-400">{res.resourceGroup}</span>
                                            </td>
                                            <td className="py-3 px-4 border-b border-gray-100 dark:border-slate-800 text-sm text-gray-600 dark:text-gray-400">{res.subscriptionId}</td>
                                            <td className="py-3 px-4 border-b border-gray-100 dark:border-slate-800 font-bold text-sm text-brand-deep text-right">{fmt.format(res.monthlyCost)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        <Pagination page={page} setPage={setPage} pageSize={pageSize} setPageSize={setPageSize} total={total} totalPages={totalPages} />
                    </>
                ) : (
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr>
                                <th className="py-3 px-4 border-b border-gray-200 dark:border-slate-700 font-bold text-xs text-gray-500 uppercase">{t("colService")}</th>
                                <th className="py-3 px-4 border-b border-gray-200 dark:border-slate-700 font-bold text-xs text-gray-500 uppercase text-right">{t("colResources")}</th>
                                <th className="py-3 px-4 border-b border-gray-200 dark:border-slate-700 font-bold text-xs text-gray-500 uppercase text-right">{t("colMonthlyCost")}</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td className="py-3 px-4 border-b border-gray-100 dark:border-slate-800 font-semibold text-sm text-gray-800 dark:text-gray-200">{data?.serviceLabel || title}</td>
                                <td className="py-3 px-4 border-b border-gray-100 dark:border-slate-800 text-sm text-right">{Number(data?.resourceCount || 0)}</td>
                                <td className="py-3 px-4 border-b border-gray-100 dark:border-slate-800 font-bold text-sm text-brand-deep text-right">{fmt.format(data?.monthlyCost || 0)}</td>
                            </tr>
                        </tbody>
                    </table>
                )}
            </div>"""
    patch_file(board_path, search_table, replace_table)

    # 3. Parchear traducciones JSON
    patch_json_i18n(os.path.join(base_dir, "messages/es.json"), "es")
    patch_json_i18n(os.path.join(base_dir, "messages/en.json"), "en")
    patch_json_i18n(os.path.join(base_dir, "messages/pt-BR.json"), "pt-BR")

    print("--- Parche de recursos completado con éxito ---")

if __name__ == "__main__":
    deploy()
