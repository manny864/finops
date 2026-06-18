import os
import json

base_dir = "/Users/manuelchavez/Documents/FinOpsProyect"

def fix_json_translations():
    locales = {
        "en.json": "Tenant Budgets",
        "es.json": "Presupuestos",
        "pt-BR.json": "Orçamentos"
    }
    
    for filename, translation in locales.items():
        filepath = os.path.join(base_dir, "messages", filename)
        if os.path.exists(filepath):
            with open(filepath, "r", encoding="utf-8") as f:
                data = json.load(f)
            
            if "Navigation" not in data:
                data["Navigation"] = {}
                
            data["Navigation"]["budgets"] = translation
            
            with open(filepath, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            print(f"Added Navigation.budgets to {filename}")

def fix_budget_burn_chart_translations():
    path = os.path.join(base_dir, "src/components/dashboard/BudgetBurnChart.tsx")
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()
    
    # next-intl with namespace 'Dashboard' already prefixes keys. 
    # Calling t('Dashboard.key') results in lookup for Dashboard.Dashboard.key
    content = content.replace("t('Dashboard.budget_by_cost_center')", "t('budget_by_cost_center')")
    content = content.replace("t('Dashboard.budget_desc')", "t('budget_desc')")
    
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)
    print("Fixed next-intl translation calls in BudgetBurnChart.tsx")

if __name__ == "__main__":
    fix_json_translations()
    fix_budget_burn_chart_translations()
    print("i18n and next-intl errors fixed.")
