import os

def modify_file(filepath, replacements):
    print(f"Modifying {filepath}...")
    with open(filepath, "r", encoding="utf-8") as f:
        content = f.read()
    
    original_content = content
    for old_str, new_str in replacements:
        if old_str not in content:
            print(f"WARNING: Could not find exact text match for replacement in {filepath}.")
            # Show a snippet of what we looked for
            print(f"Looking for:\n{old_str[:150]}...")
            continue
        content = content.replace(old_str, new_str)
    
    if content != original_content:
        with open(filepath, "w", encoding="utf-8") as f:
            f.write(content)
        print(f"Successfully modified {filepath}.")
    else:
        print(f"No changes made to {filepath}.")

def main():
    base_dir = "/Users/manuelchavez/Documents/FinOpsProyect"
    
    # 1. page.tsx changes
    page_path = os.path.join(base_dir, "src/app/[locale]/page.tsx")
    page_replacements = [
        (
            "import { useTenant } from '@/components/TenantProvider';",
            "import { useTenant } from '@/components/TenantProvider';\nimport { useSubscription } from '@/components/SubscriptionProvider';"
        ),
        (
            "  const { selectedTenant } = useTenant();",
            "  const { selectedTenant } = useTenant();\n  const { selectedSubscription } = useSubscription();"
        ),
        (
            '              // Fetch audit + advisor in parallel\n              const [auditRes, advisorRes] = await Promise.allSettled([\n                  fetch(`/api/audit/full?tenantId=${selectedTenant.id}`, {\n                      headers: { \'Authorization\': `Bearer ${tokenResponse.idToken}` }\n                  }),\n                  fetch(`/api/advisor?tenantId=${selectedTenant.id}`, {\n                      headers: { \'Authorization\': `Bearer ${tokenResponse.idToken}` }\n                  })\n              ]);',
            '              const subParam = (!selectedSubscription || selectedSubscription.toLowerCase() === \'all\') ? \'\' : `&subscriptionId=${selectedSubscription}`;\n              // Fetch audit + advisor in parallel\n              const [auditRes, advisorRes] = await Promise.allSettled([\n                  fetch(`/api/audit/full?tenantId=${selectedTenant.id}${subParam}`, {\n                      headers: { \'Authorization\': `Bearer ${tokenResponse.idToken}` }\n                  }),\n                  fetch(`/api/advisor?tenantId=${selectedTenant.id}${subParam}`, {\n                      headers: { \'Authorization\': `Bearer ${tokenResponse.idToken}` }\n                  })\n              ]);'
        ),
        (
            "  }, [activeTab, selectedTenant, accounts, instance]);",
            "  }, [activeTab, selectedTenant, selectedSubscription, accounts, instance]);"
        )
    ]
    modify_file(page_path, page_replacements)

    # 2. ZombieResourcesTable.tsx changes
    zombie_path = os.path.join(base_dir, "src/components/ZombieResourcesTable.tsx")
    zombie_replacements = [
        (
            "import { useTenant } from './TenantProvider';",
            "import { useTenant } from './TenantProvider';\nimport { useSubscription } from './SubscriptionProvider';"
        ),
        (
            '  const { viewMode } = useViewMode();\n  const { addAction } = useActionLogStore();\n  const triggerCopilotWithPrompt = useAIContext(state => state.triggerCopilotWithPrompt);\n  \n  // Removed conditional useTranslations hook which was causing React Error 310\n  const [data, setData] = useState<any[]>([]);\n  const [subscriptions, setSubscriptions] = useState<any[]>([]);\n  const [selectedSub, setSelectedSub] = useState<string>("all");',
            '  const { viewMode } = useViewMode();\n  const { addAction } = useActionLogStore();\n  const triggerCopilotWithPrompt = useAIContext(state => state.triggerCopilotWithPrompt);\n  const { selectedSubscription, setSelectedSubscription } = useSubscription();\n  \n  // Removed conditional useTranslations hook which was causing React Error 310\n  const [data, setData] = useState<any[]>([]);\n  const [subscriptions, setSubscriptions] = useState<any[]>([]);\n  const [selectedSub, setSelectedSub] = useState<string>("all");\n\n  useEffect(() => {\n    if (selectedSubscription) {\n      setSelectedSub(selectedSubscription.toLowerCase() === \'all\' ? \'all\' : selectedSubscription);\n    }\n  }, [selectedSubscription]);'
        ),
        (
            '                <select \n                    value={selectedSub}\n                    onChange={(e) => setSelectedSub(e.target.value)}',
            '                <select \n                    value={selectedSub}\n                    onChange={(e) => {\n                        const val = e.target.value;\n                        setSelectedSub(val);\n                        setSelectedSubscription(val === \'all\' ? \'All\' : val);\n                    }}'
        )
    ]
    modify_file(zombie_path, zombie_replacements)

    # 3. AdvisorPanel.tsx changes
    advisor_path = os.path.join(base_dir, "src/components/AdvisorPanel.tsx")
    advisor_replacements = [
        (
            "import { useTenant } from './TenantProvider';",
            "import { useTenant } from './TenantProvider';\nimport { useSubscription } from './SubscriptionProvider';"
        ),
        (
            '  const [loading, setLoading] = useState(true);\n  const [error, setError] = useState<string | null>(null);\n  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);\n  const [selectedSub, setSelectedSub] = useState<string>("all");',
            '  const [loading, setLoading] = useState(true);\n  const [error, setError] = useState<string | null>(null);\n  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);\n  const [selectedSub, setSelectedSub] = useState<string>("all");\n  const { selectedSubscription, setSelectedSubscription } = useSubscription();\n\n  useEffect(() => {\n    if (selectedSubscription) {\n      setSelectedSub(selectedSubscription.toLowerCase() === \'all\' ? \'all\' : selectedSubscription);\n    }\n  }, [selectedSubscription]);'
        ),
        (
            '                    <select\n                        value={selectedSub}\n                        onChange={(e) => { setSelectedSub(e.target.value); setSelectedCategory(null); }}',
            '                    <select\n                        value={selectedSub}\n                        onChange={(e) => {\n                            const val = e.target.value;\n                            setSelectedSub(val);\n                            setSelectedCategory(null);\n                            setSelectedSubscription(val === \'all\' ? \'All\' : val);\n                        }}'
        )
    ]
    modify_file(advisor_path, advisor_replacements)

    # 4. CostPieChart.tsx changes
    cost_pie_path = os.path.join(base_dir, "src/components/CostPieChart.tsx")
    cost_pie_replacements = [
        (
            '    return (\n        <div className="w-full min-h-[350px] relative overflow-hidden">\n            <ResponsiveContainer width="100%" height="100%">',
            '    return (\n        <div className="w-full h-full min-h-[220px] relative overflow-hidden flex-1 flex flex-col justify-center items-center">\n            <ResponsiveContainer width="100%" height="100%">'
        )
    ]
    modify_file(cost_pie_path, cost_pie_replacements)

    # 5. FocusCostPieChart.tsx changes
    focus_pie_path = os.path.join(base_dir, "src/components/dashboard/FocusCostPieChart.tsx")
    focus_pie_replacements = [
        (
            '    return (\n        <div className="w-full min-h-[350px] relative overflow-hidden">\n            <ResponsiveContainer width="100%" height="100%">',
            '    return (\n        <div className="w-full h-full min-h-[220px] relative overflow-hidden flex-1 flex flex-col justify-center items-center">\n            <ResponsiveContainer width="100%" height="100%">'
        )
    ]
    modify_file(focus_pie_path, focus_pie_replacements)

    # 6. InteractiveDashboard.tsx changes
    interactive_path = os.path.join(base_dir, "src/components/dashboard/InteractiveDashboard.tsx")
    interactive_replacements = [
        (
            '                    <div className="flex items-center justify-center h-64">\n                        <div className="w-full h-full relative flex items-center justify-center">\n                            <FocusCostPieChart data={entries} />\n                        </div>\n                    </div>',
            '                    <div className="h-64 w-full relative flex items-center justify-center">\n                        <div className="w-full h-full absolute inset-0">\n                            <FocusCostPieChart data={entries} />\n                        </div>\n                    </div>'
        ),
        (
            '                    <div className="flex items-center justify-center h-64">\n                        {leakagePieData.length > 0 ? (\n                            <ResponsiveContainer width="100%" height="100%">\n                                <RechartsPieChart>\n                                    <Pie data={leakagePieData} cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="value">\n                                        {leakagePieData.map((e, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}\n                                    </Pie>\n                                    <RechartsTooltip formatter={(v: any) => `$${Number(v).toFixed(2)}`} />\n                                </RechartsPieChart>\n                            </ResponsiveContainer>\n                        ) : (\n                            <div className="text-sm text-slate-400">Sin datos de fugas</div>\n                        )}\n                    </div>',
            '                    <div className="h-64 w-full relative flex items-center justify-center">\n                        {leakagePieData.length > 0 ? (\n                            <div className="w-full h-full absolute inset-0">\n                                <ResponsiveContainer width="100%" height="100%">\n                                    <RechartsPieChart>\n                                        <Pie data={leakagePieData} cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="value">\n                                            {leakagePieData.map((e, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}\n                                        </Pie>\n                                        <RechartsTooltip formatter={(v: any) => `$${Number(v).toFixed(2)}`} />\n                                    </RechartsPieChart>\n                                </ResponsiveContainer>\n                            </div>\n                        ) : (\n                            <div className="text-sm text-slate-400">Sin datos de fugas</div>\n                        )}\n                    </div>'
        )
    ]
    modify_file(interactive_path, interactive_replacements)

if __name__ == "__main__":
    main()
