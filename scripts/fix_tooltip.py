import os

base_dir = "/Users/manuelchavez/Documents/FinOpsProyect"

def update_ui():
    path = os.path.join(base_dir, "src/components/CostPieChart.tsx")
    with open(path, "r") as f:
        content = f.read()
    
    old_map = """    const chartData = Object.keys(grouped).map(key => ({
        name: key,
        value: grouped[key].count,
        savings: Number(grouped[key].savings.toFixed(2))
    })).filter(d => d.value > 0).sort((a,b) => b.value - a.value);"""
    
    new_map = """    const chartData = Object.keys(grouped).map(key => ({
        name: key,
        count: grouped[key].count,
        savings: Number(grouped[key].savings.toFixed(2))
    })).filter(d => d.count > 0).sort((a,b) => b.count - a.count);"""
    
    content = content.replace(old_map, new_map)
    
    old_tooltip = """                    <Tooltip 
                        formatter={(value: any, name: any, props: any) => [`$${value} USD (${props.payload?.count ?? props.payload?.payload?.count ?? 0} recursos)`, name]}
                        contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                    />"""
                    
    new_tooltip = """                    <Tooltip 
                        formatter={(value: any, name: any, props: any) => {
                            const recursos = props.payload?.count ?? props.payload?.payload?.count ?? 0;
                            return [`$${value} USD (${recursos} recursos detectados)`, name];
                        }}
                        contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                    />"""
                    
    content = content.replace(old_tooltip, new_tooltip)
    
    with open(path, "w") as f:
        f.write(content)

def update_sop():
    path = os.path.join(base_dir, "directivas/audit_and_tags_enhancement_SOP.md")
    if os.path.exists(path):
        with open(path, "a") as f:
            f.write("- **CostPieChart Tooltip**: Se corrigió el mapeo de variables para que el tooltip muestre correctamente la cantidad de recursos (`count`) además del costo.\\n")

if __name__ == "__main__":
    update_ui()
    update_sop()
    print("Tooltip fix deploy completado.")
