import os

base_dir = "/Users/manuelchavez/Documents/FinOpsProyect"

def update_frontend_sop():
    path = os.path.join(base_dir, "directivas/agent_frontend_SOP.md")
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()
    
    rule = """
5. **Prevención de Errores de Hidratación (Hydration Errors):**
   - **Recharts / Gráficos:** Los componentes de Recharts (como `ResponsiveContainer`) calculan dimensiones que difieren entre el servidor y el cliente. Para evitar errores de hidratación, envuelve el renderizado del gráfico en una condición `isMounted` (`const [isMounted, setIsMounted] = useState(false); useEffect(() => setIsMounted(true), [])`) o cárgalo dinámicamente con `next/dynamic` y `ssr: false`.
   - **Rules of Hooks:** Nunca utilices `require()` o llamadas a hooks condicionales (ej. `try/catch` envolviendo a `useTranslations()`) dentro del cuerpo de un componente React.
"""
    if "Prevención de Errores de Hidratación" not in content:
        with open(path, "a", encoding="utf-8") as f:
            f.write(rule)
        print("agent_frontend_SOP.md updated with Hydration rules.")

def fix_budget_burn_chart():
    path = os.path.join(base_dir, "src/components/dashboard/BudgetBurnChart.tsx")
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()

    # 1. Fix Rules of Hooks (useTranslations inside try/catch)
    bad_hook = """    let t: any = (key: string) => key;
    try {
      const nextIntl = require('next-intl');
      if (nextIntl && nextIntl.useTranslations) {
        t = nextIntl.useTranslations();
      }
    } catch (e) {}"""
    
    if bad_hook in content:
        content = content.replace(bad_hook, "    const t = useTranslations('Dashboard');")
        # Add import if missing
        if "useTranslations" not in content[:content.find("export default")]:
            content = "import { useTranslations } from 'next-intl';\n" + content

    # 2. Add isMounted state to fix Recharts Hydration
    if "const [isMounted, setIsMounted] = useState(false);" not in content:
        hook_injection = """    const [isMounted, setIsMounted] = useState(false);
    useEffect(() => {
        setIsMounted(true);
    }, []);"""
        content = content.replace("const [loading, setLoading] = useState(false);", "const [loading, setLoading] = useState(false);\n" + hook_injection)

    # 3. Only render ResponsiveContainer if isMounted
    if "!isMounted ? null :" not in content:
        content = content.replace("<ResponsiveContainer width=\"100%\" height=\"100%\">", "{!isMounted ? null : <ResponsiveContainer width=\"100%\" height=\"100%\">}")
        content = content.replace("</ResponsiveContainer>", "</ResponsiveContainer>}")

    with open(path, "w", encoding="utf-8") as f:
        f.write(content)
    print("BudgetBurnChart.tsx fixed for Hydration and Rules of Hooks.")

if __name__ == "__main__":
    update_frontend_sop()
    fix_budget_burn_chart()
    print("Hydration fix applied.")
