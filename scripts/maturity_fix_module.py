import os

base_dir = "/Users/manuelchavez/Documents/FinOpsProyect"

def deploy():
    print("1. Creando Directiva SOP...")
    os.makedirs(os.path.join(base_dir, "directivas"), exist_ok=True)
    sop_path = os.path.join(base_dir, "directivas/maturity_reactivity_SOP.md")
    with open(sop_path, "w") as f:
        f.write("# Maturity Reactivity SOP\\n\\n")
        f.write("## Objetivo\\n1. Reparar la reactividad en `overview/maturity/page.tsx` para que al cambiar el `selectedTenant`, la UI actualice correctamente su estado.\\n")
        f.write("2. Mejorar la UX manteniendo la estructura de la página y mostrando un spinner sobre las tarjetas en lugar de desmontar todo el componente.\\n\\n")
        f.write("## Restricciones/Casos Borde\\n- **Nota**: El mock actual retorna siempre los mismos valores, lo que causaba la ilusión de falta de reactividad. Se debe usar el `tenantId` para variar los datos o limpiar explícitamente el estado anterior.\\n")

    print("2. Parcheando maturity/page.tsx...")
    page_path = os.path.join(base_dir, "src/app/[locale]/overview/maturity/page.tsx")
    with open(page_path, "r") as f:
        page_content = f.read()

    # Change the loading behavior to not unmount the whole page
    if "if (loading || !scoreData) {" in page_content:
        # We will remove the early return and handle loading inline
        page_content = page_content.replace("""    if (loading || !scoreData) {
        return (
            <div className="flex flex-col items-center justify-center h-96 text-gray-400 animate-pulse">
                Calculando Madurez FinOps...
            </div>
        );
    }""", "")
        
        # Replace the useEffect dependencies to explicitly include selectedTenant.id
        page_content = page_content.replace("[selectedTenant, accounts, instance]", "[selectedTenant.id, accounts, instance]")
        
        # In the useEffect, add setScoreData(null) to clear previous data
        page_content = page_content.replace("setLoading(true);", "setLoading(true);\\n            setScoreData(null);")
        
        # Wrap the grid in a relative container with loading overlay
        grid_start = '<div className="grid grid-cols-1 lg:grid-cols-3 gap-8">'
        new_grid_start = """
            <div className="relative">
                {(loading || !scoreData) && (
                    <div className="absolute inset-0 bg-white/60 dark:bg-slate-900/60 z-50 flex flex-col items-center justify-center rounded-2xl backdrop-blur-sm">
                        <Loader2 className="w-10 h-10 text-indigo-600 animate-spin mb-4" />
                        <span className="text-lg font-semibold text-gray-700 dark:text-gray-300">Procesando telemetría del cliente...</span>
                    </div>
                )}
                <div className={`grid grid-cols-1 lg:grid-cols-3 gap-8 ${(loading || !scoreData) ? 'opacity-50 pointer-events-none' : ''}`}>"""
        
        page_content = page_content.replace(grid_start, new_grid_start)
        page_content = page_content.replace("</svg>\\n                        <div", "</svg>\\n                        <div") # Just to find it
        
        # Add Loader2 to imports
        page_content = page_content.replace("AlertTriangle, CheckCircle2 } from 'lucide-react';", "AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';")

        # Safely handle getPhaseInfo since scoreData could be null
        page_content = page_content.replace("const phase = getPhaseInfo(scoreData.overallScore);", "const phase = scoreData ? getPhaseInfo(scoreData.overallScore) : getPhaseInfo(0);")
        page_content = page_content.replace("scoreData.overallScore", "(scoreData?.overallScore || 0)")
        page_content = page_content.replace("scoreData.pillars.ResourceCleanup", "(scoreData?.pillars?.ResourceCleanup || 0)")
        page_content = page_content.replace("scoreData.pillars.TaggingCompliance", "(scoreData?.pillars?.TaggingCompliance || 0)")
        page_content = page_content.replace("scoreData.pillars.CostEfficiency", "(scoreData?.pillars?.CostEfficiency || 0)")

        with open(page_path, "w") as f:
            f.write(page_content)

    print("3. Actualizando maturity/route.ts para ser determinista por tenant...")
    route_path = os.path.join(base_dir, "src/app/api/intelligence/maturity/route.ts")
    with open(route_path, "r") as f:
        route_content = f.read()

    new_mock_logic = """    const calculateMaturityScore = (tId: string) => {
      // Deterministic pseudo-random based on tenantId length/chars so it changes per tenant
      const seed = tId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
      return {
        overallScore: 40 + (seed % 50), // 40-90
        pillars: {
          ResourceCleanup: 30 + (seed % 60),
          TaggingCompliance: 50 + (seed % 45),
          CostEfficiency: 40 + ((seed*2) % 55)
        }
      };
    };

    const maturityData = calculateMaturityScore(tenantId);"""

    route_content = route_content.replace("""    const calculateMaturityScore = () => {
      // Logic to calculate based on actual audit data would go here
      // Returning mock data for now
      return {
        overallScore: 58,
        pillars: {
          ResourceCleanup: 45,
          TaggingCompliance: 62,
          CostEfficiency: 68
        }
      };
    };

    const maturityData = calculateMaturityScore();""", new_mock_logic)
    
    with open(route_path, "w") as f:
        f.write(route_content)

    print("Script completado.")

if __name__ == "__main__":
    deploy()
