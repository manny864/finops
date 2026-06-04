import os
import re

base_dir = "/Users/manuelchavez/Documents/FinOpsProyect"

def update_pie_chart():
    path = os.path.join(base_dir, "src/components/CostPieChart.tsx")
    with open(path, "r") as f:
        content = f.read()

    # Change dataKey from value to savings
    content = content.replace('dataKey="value"', 'dataKey="savings"')

    # Change Tooltip
    old_tooltip = "formatter={(value: any, name: any, props: any) => [`${value} recursos ($${props.payload.savings} USD ahorro potencial)`, name]}"
    new_tooltip = "formatter={(value: any, name: any, props: any) => [`$${value} USD (${props.payload.count} recursos)`, name]}"
    content = content.replace(old_tooltip, new_tooltip)

    with open(path, "w") as f:
        f.write(content)
    print("CostPieChart updated.")

def update_table():
    path = os.path.join(base_dir, "src/components/ZombieResourcesTable.tsx")
    with open(path, "r") as f:
        content = f.read()

    # Add sortConfig state
    if "const [sortConfig" not in content:
        content = content.replace(
            "const [filterIssue, setFilterIssue] = useState<string>('all');",
            "const [filterIssue, setFilterIssue] = useState<string>('all');\\n  const [sortConfig, setSortConfig] = useState<{ key: string, direction: 'asc' | 'desc' } | null>({ key: 'potentialSavings', direction: 'desc' });"
        )

    # Update mapped potentialSavings to use estimatedMonthlyCost if available
    old_mapping = "potentialSavings: r.diskSizeGB ? r.diskSizeGB * 0.15 : (r.sizeGB ? r.sizeGB * 0.05 : config.savings),"
    new_mapping = "potentialSavings: r.estimatedMonthlyCost ?? (r.diskSizeGB ? r.diskSizeGB * 0.15 : (r.sizeGB ? r.sizeGB * 0.05 : config.savings)),"
    content = content.replace(old_mapping, new_mapping)

    # Update Table Header
    old_th = '<th className="p-4 font-medium text-right">Ahorro Mensual (USD)</th>'
    new_th = """<th className="p-4 font-medium text-right cursor-pointer hover:text-[#0054A6] transition-colors" onClick={() => setSortConfig(prev => ({ key: 'potentialSavings', direction: prev?.direction === 'desc' ? 'asc' : 'desc' }))}>
                    Ahorro Mensual Estimado {sortConfig?.key === 'potentialSavings' ? (sortConfig.direction === 'asc' ? '↑' : '↓') : ''}
                </th>"""
    content = content.replace(old_th, new_th)

    # Update cell formatting
    old_td = '<td className="p-4 text-sm font-bold text-right ${item.potentialSavings > 0 ? \'text-green-600\' : \'text-gray-400\'}">\\${item.potentialSavings > 0 ? `$` + Number(item.potentialSavings).toFixed(2) : "-"}</td>'
    new_td = '<td className={`p-4 text-sm font-bold text-right ${item.potentialSavings > 0 ? "text-green-600" : "text-gray-400"}`}>{item.potentialSavings > 0 ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(item.potentialSavings) : "-"}</td>'
    
    # In some places it might have been written with backticks or not evaluated properly in the original code. Let's do a robust replace.
    import re
    content = re.sub(
        r'<td className="p-4 text-sm font-bold text-right \$\{.*?</td>',
        new_td,
        content
    )

    # Update filtering logic to include sorting
    old_filter = """              {data.length > 0 ? data.filter(item => {
                  const matchType = filterType === "all" || item.type === filterType;
                  const matchGroup = filterGroup === "all" || item.resourceGroup === filterGroup;
                  const matchIssue = filterIssue === "all" || item.issueType === filterIssue;
                  return matchType && matchGroup && matchIssue;
              }).map((item, i) => ("""
    
    new_filter = """              {data.length > 0 ? data.filter(item => {
                  const matchType = filterType === "all" || item.type === filterType;
                  const matchGroup = filterGroup === "all" || item.resourceGroup === filterGroup;
                  const matchIssue = filterIssue === "all" || item.issueType === filterIssue;
                  return matchType && matchGroup && matchIssue;
              }).sort((a, b) => {
                  if (!sortConfig) return 0;
                  if (a[sortConfig.key] < b[sortConfig.key]) return sortConfig.direction === 'asc' ? -1 : 1;
                  if (a[sortConfig.key] > b[sortConfig.key]) return sortConfig.direction === 'asc' ? 1 : -1;
                  return 0;
              }).map((item, i) => ("""
    
    content = content.replace(old_filter, new_filter)

    with open(path, "w") as f:
        f.write(content)
    print("ZombieResourcesTable updated.")

def update_page():
    path = os.path.join(base_dir, "src/app/page.tsx")
    with open(path, "r") as f:
        content = f.read()

    # Calculate total savings
    if "const totalSavings =" not in content:
        content = content.replace(
            "const { selectedTenant } = useTenant();",
            "const { selectedTenant } = useTenant();\\n  const totalSavings = dashboardData.reduce((sum, item) => sum + (item.potentialSavings || 0), 0);"
        )

    # Inject Massive Metric UI at the top
    target = """      <div className="flex justify-between items-end border-b border-gray-200 pb-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard General</h1>
          <p className="text-sm text-gray-500 mt-1">Visión global de rendimiento y eficiencia en la nube.</p>
        </div>
      </div>"""

    new_ui = """      <div className="flex flex-col md:flex-row justify-between items-start md:items-end border-b border-gray-200 pb-4 gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard General</h1>
          <p className="text-sm text-gray-500 mt-1">Visión global de rendimiento y eficiencia en la nube.</p>
        </div>
        
        <div className="bg-green-50 border border-green-200 rounded-xl px-6 py-3 flex flex-col items-end shadow-sm">
            <span className="text-xs font-bold text-green-700 uppercase tracking-widest mb-1">Ahorro Potencial Total</span>
            <span className="text-4xl lg:text-5xl font-extrabold text-green-600">
                {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(totalSavings)}
            </span>
            <span className="text-xs text-green-600 mt-1">/mes proyectado</span>
        </div>
      </div>"""

    content = content.replace(target, new_ui)

    with open(path, "w") as f:
        f.write(content)
    print("page.tsx updated.")

if __name__ == "__main__":
    update_pie_chart()
    update_table()
    update_page()
    print("UI Cost Avoidance modifications complete.")
