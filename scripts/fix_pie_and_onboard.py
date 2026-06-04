import os

def fix_pie_chart():
    base_dir = "/Users/manuelchavez/Documents/FinOpsProyect"
    pie_path = os.path.join(base_dir, "src/components/CostPieChart.tsx")
    with open(pie_path, "r") as f:
        content = f.read()

    # Update reduce logic
    old_reduce = """    const grouped = data.reduce((acc: any, item: any) => {
        if (item.issueType !== 'cost' || item.potentialSavings <= 0) return acc;
        if (!acc[item.type]) acc[item.type] = 0;
        acc[item.type] += item.potentialSavings;
        return acc;
    }, {});

    const chartData = Object.keys(grouped).map(key => ({
        name: key,
        value: Number(grouped[key].toFixed(2))
    })).filter(d => d.value > 0).sort((a,b) => b.value - a.value);"""

    new_reduce = """    const grouped = data.reduce((acc: any, item: any) => {
        if (item.issueType !== 'cost' || item.potentialSavings <= 0) return acc;
        if (!acc[item.type]) acc[item.type] = { count: 0, savings: 0 };
        acc[item.type].count += 1;
        acc[item.type].savings += item.potentialSavings;
        return acc;
    }, {});

    const chartData = Object.keys(grouped).map(key => ({
        name: key,
        value: grouped[key].count,
        savings: Number(grouped[key].savings.toFixed(2))
    })).filter(d => d.value > 0).sort((a,b) => b.value - a.value);"""

    content = content.replace(old_reduce, new_reduce)

    # Update tooltip
    old_tooltip = """                    <Tooltip 
                        formatter={(value: any) => [`$${value} USD`, 'Ahorro Potencial']}
                        contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                    />"""
                    
    new_tooltip = """                    <Tooltip 
                        formatter={(value: any, name: string, props: any) => [`${value} recursos ($${props.payload.savings} USD ahorro potencial)`, name]}
                        contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                    />"""

    content = content.replace(old_tooltip, new_tooltip)

    with open(pie_path, "w") as f:
        f.write(content)

def fix_api_onboard():
    base_dir = "/Users/manuelchavez/Documents/FinOpsProyect"
    onboard_path = os.path.join(base_dir, "src/app/api/onboard/route.ts")
    with open(onboard_path, "r") as f:
        content = f.read()

    old_logic = """        const tenantId = decoded.tid;
        const entraOid = decoded.oid;
        const companyName = decoded.name || "Default Company";
        const email = decoded.preferred_username || decoded.email || "Unknown";"""

    new_logic = """        const tenantId = decoded.tid;
        const entraOid = decoded.oid;
        const email = decoded.preferred_username || decoded.email || "Unknown";
        
        let companyName = "Entorno: " + tenantId.substring(0,8);
        if (email.includes('@')) {
            companyName = email.split('@')[1];
        }"""

    content = content.replace(old_logic, new_logic)
    with open(onboard_path, "w") as f:
        f.write(content)

def main():
    fix_pie_chart()
    fix_api_onboard()

if __name__ == "__main__":
    main()
