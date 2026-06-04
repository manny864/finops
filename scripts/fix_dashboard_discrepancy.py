import os
import re

base_dir = "/Users/manuelchavez/Documents/FinOpsProyect"

def fix_table():
    path = os.path.join(base_dir, "src/components/ZombieResourcesTable.tsx")
    with open(path, "r") as f:
        content = f.read()

    # Change ?? to || so that 0 falls back to the static calculation
    content = content.replace(
        "potentialSavings: r.estimatedMonthlyCost ?? (r.diskSizeGB ? r.diskSizeGB * 0.15 : (r.sizeGB ? r.sizeGB * 0.05 : config.savings)),",
        "potentialSavings: r.estimatedMonthlyCost || (r.diskSizeGB ? r.diskSizeGB * 0.15 : (r.sizeGB ? r.sizeGB * 0.05 : config.savings)),"
    )

    with open(path, "w") as f:
        f.write(content)
    print("ZombieResourcesTable fixed.")

def fix_page():
    path = os.path.join(base_dir, "src/app/page.tsx")
    with open(path, "r") as f:
        content = f.read()

    # Apply the same mapping logic in page.tsx
    content = content.replace(
        "potentialSavings: r.diskSizeGB ? r.diskSizeGB * 0.15 : (r.sizeGB ? r.sizeGB * 0.05 : (config as any).savings)",
        "potentialSavings: r.estimatedMonthlyCost || (r.diskSizeGB ? r.diskSizeGB * 0.15 : (r.sizeGB ? r.sizeGB * 0.05 : (config as any).savings))"
    )

    with open(path, "w") as f:
        f.write(content)
    print("page.tsx fixed.")

def fix_pie_chart():
    path = os.path.join(base_dir, "src/components/CostPieChart.tsx")
    with open(path, "r") as f:
        content = f.read()

    # Fix undefined recursos by checking both props.payload.count and props.payload.payload.count
    content = content.replace(
        "formatter={(value: any, name: any, props: any) => [`$${value} USD (${props.payload.count} recursos)`, name]}",
        "formatter={(value: any, name: any, props: any) => [`$${value} USD (${props.payload?.count ?? props.payload?.payload?.count ?? 0} recursos)`, name]}"
    )

    with open(path, "w") as f:
        f.write(content)
    print("CostPieChart fixed.")

def update_sop():
    path = os.path.join(base_dir, "directivas/azure_pricing_SOP.md")
    if os.path.exists(path):
        with open(path, "a") as f:
            f.write("\\n- **Fallback Lógico**: Si la API de Retail Prices falla o no encuentra el SKU exacto (ej. devuelve 0), el frontend DEBE usar el operador lógico `||` para recaer sobre el cálculo matemático genérico (ej. `r.diskSizeGB * 0.15`). Nunca usar `??` ya que `0 ?? fallback` evalúa a `0`.\\n")

if __name__ == "__main__":
    fix_table()
    fix_page()
    fix_pie_chart()
    update_sop()
    print("All fixes applied.")
