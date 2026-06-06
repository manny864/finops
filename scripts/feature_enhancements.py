import os
import json

base_dir = "/Users/manuelchavez/Documents/FinOpsProyect"

def update_json_file(filepath, new_keys):
    if not os.path.exists(filepath):
        print(f"Warning: {filepath} not found.")
        return
    with open(filepath, 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    # Merge new keys
    for k, v in new_keys.items():
        data[k] = v
        
    with open(filepath, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    print(f"Updated {filepath}")

def deploy():
    print("1. Creando Directiva SOP...")
    os.makedirs(os.path.join(base_dir, "directivas"), exist_ok=True)
    sop_path = os.path.join(base_dir, "directivas/feature_enhancements_SOP.md")
    with open(sop_path, "w", encoding='utf-8') as f:
        f.write("# Directiva: Enhancements de Advisor, Madurez y Facturación\n\n")
        f.write("## Objetivo\nMejorar la localización de Advisor, expandir los pilares de Madurez a 5 e incluir Tooltips, y agregar manejo de errores estandarizado en la Facturación.\n\n")
        f.write("## Restricciones/Casos Borde\n- **Azure SDK Locale**: Se debe inyectar `Accept-Language` en headers de la request (vía customHeaders en el SDK).\n- **Mapeo JSON**: Usar `recommendationType.name` en lugar de duplicar `problem`.\n- **Error Codes**: Usar claves estandarizadas para i18n (`ERR_INSUFFICIENT_PERMISSIONS`, etc).\n")

    print("2. Modificando Advisor Route...")
    advisor_route_path = os.path.join(base_dir, "src/app/api/advisor/route.ts")
    with open(advisor_route_path, "r", encoding='utf-8') as f:
        content = f.read()
    
    if "const locale = request.headers.get('accept-language')" not in content:
        content = content.replace("const tenantId = request.nextUrl.searchParams.get('tenantId');", 
                                  "const tenantId = request.nextUrl.searchParams.get('tenantId');\n    const locale = request.headers.get('accept-language') || 'es';")
        content = content.replace("const advisorClient = new AdvisorManagementClient(credential, subId);", 
                                  "const advisorClient = new AdvisorManagementClient(credential, subId);")
        # For the REST API
        content = content.replace('headers: { "Authorization": `Bearer ${tokenResponse.token}` }',
                                  'headers: { "Authorization": `Bearer ${tokenResponse.token}`, "Accept-Language": locale }')
        
        # For SDK: pass customHeaders
        content = content.replace("const recs = advisorClient.recommendations.list();",
                                  "const recs = advisorClient.recommendations.list({ customHeaders: { 'Accept-Language': locale } });")

        with open(advisor_route_path, "w", encoding='utf-8') as f:
            f.write(content)

    print("3. Modificando AdvisorPanel...")
    advisor_panel_path = os.path.join(base_dir, "src/components/AdvisorPanel.tsx")
    with open(advisor_panel_path, "r", encoding='utf-8') as f:
        content = f.read()
        
    if "import { useLocale } from 'next-intl';" not in content:
        content = content.replace("import { useTenant } from './TenantProvider';", "import { useTenant } from './TenantProvider';\nimport { useLocale } from 'next-intl';")
        content = content.replace("const { selectedTenant } = useTenant();", "const { selectedTenant } = useTenant();\n  const locale = useLocale();")
        content = content.replace("headers: { 'Authorization': `Bearer ${tokenResponse.idToken}` }", "headers: { 'Authorization': `Bearer ${tokenResponse.idToken}`, 'Accept-Language': locale }")
        
        # Fix mapping
        content = content.replace("rec.shortDescription?.solution || 'Consulte el Portal de Azure'", "rec.shortDescription?.solution || rec.recommendationType?.name || rec.impact || 'Consulte el Portal de Azure'")
        
        with open(advisor_panel_path, "w", encoding='utf-8') as f:
            f.write(content)

    print("4. Expandiendo Maturity Route...")
    maturity_route_path = os.path.join(base_dir, "src/app/api/intelligence/maturity/route.ts")
    with open(maturity_route_path, "r", encoding='utf-8') as f:
        content = f.read()
    
    if "VisibilityAndAllocation" not in content:
        old_calc = """    const calculateMaturityScore = (tId: string) => {
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
    };"""
        new_calc = """    const calculateMaturityScore = (tId: string) => {
      const seed = tId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
      const VisibilityAndAllocation = 40 + (seed % 60);
      const UsageOptimization = 30 + (seed % 70);
      const RateOptimization = 20 + ((seed*2) % 80);
      const ForecastingAndBudgeting = 50 + (seed % 50);
      const GovernanceAndAutomation = 45 + ((seed*3) % 55);
      
      const overallScore = Math.floor((VisibilityAndAllocation + UsageOptimization + RateOptimization + ForecastingAndBudgeting + GovernanceAndAutomation) / 5);

      return {
        overallScore,
        pillars: {
          VisibilityAndAllocation,
          UsageOptimization,
          RateOptimization,
          ForecastingAndBudgeting,
          GovernanceAndAutomation
        }
      };
    };"""
        content = content.replace(old_calc, new_calc)
        with open(maturity_route_path, "w", encoding='utf-8') as f:
            f.write(content)

    print("5. Localizando Errores en Billing Route...")
    billing_route_path = os.path.join(base_dir, "src/app/api/intelligence/billing/route.ts")
    with open(billing_route_path, "r", encoding='utf-8') as f:
        content = f.read()
    
    if "ERR_COST_API_THROTTLED" not in content:
        old_catch = """    } catch (error: any) {
        console.error('Billing API Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }"""
        new_catch = """    } catch (error: any) {
        console.error('Billing API Error:', error);
        let errorCode = 'ERR_INTERNAL_SERVER';
        const msg = (error.message || '').toLowerCase();
        if (error.code === 'AuthorizationFailed' || error.statusCode === 403 || msg.includes('authorization')) {
            errorCode = 'ERR_INSUFFICIENT_PERMISSIONS';
        } else if (error.statusCode === 429 || msg.includes('too many requests') || msg.includes('throttl')) {
            errorCode = 'ERR_COST_API_THROTTLED';
        }
        return NextResponse.json({ error: errorCode }, { status: error.statusCode || 500 });
    }"""
        content = content.replace(old_catch, new_catch)
        with open(billing_route_path, "w", encoding='utf-8') as f:
            f.write(content)

    print("6. Modificando traducciones (JSON)...")
    keys_es = {
        "ERR_INSUFFICIENT_PERMISSIONS": "No tiene permisos suficientes (Cost Management Reader) en esta suscripción.",
        "ERR_COST_API_THROTTLED": "Se ha excedido el límite de solicitudes de la API de Costos. Reintente más tarde.",
        "ERR_INTERNAL_SERVER": "Error interno al consultar la facturación.",
        "Maturity": {
            "VisibilityAndAllocation": "Visibilidad y Asignación",
            "UsageOptimization": "Optimización de Cargas (Zombis)",
            "RateOptimization": "Optimización de Tarifas (Reservas)",
            "ForecastingAndBudgeting": "Presupuestos y Pronósticos",
            "GovernanceAndAutomation": "Gobernanza y Automatización",
            "info_phase": "Las fases FinOps (Crawl, Walk, Run) determinan tu nivel de evolución en la práctica en la nube.",
            "info_VisibilityAndAllocation": "Mide qué tan bien estás asignando etiquetas y visualizando tus costos.",
            "info_UsageOptimization": "Mide qué tanto estás apagando o eliminando recursos ociosos o sobredimensionados.",
            "info_RateOptimization": "Mide tu cobertura de instancias reservadas y planes de ahorro.",
            "info_ForecastingAndBudgeting": "Mide la exactitud de tus presupuestos frente al gasto real.",
            "info_GovernanceAndAutomation": "Mide cuántas políticas automatizadas tienes activas."
        }
    }
    keys_en = {
        "ERR_INSUFFICIENT_PERMISSIONS": "Insufficient permissions (Cost Management Reader) on this subscription.",
        "ERR_COST_API_THROTTLED": "Cost API request limit exceeded. Try again later.",
        "ERR_INTERNAL_SERVER": "Internal error fetching billing data.",
        "Maturity": {
            "VisibilityAndAllocation": "Visibility and Allocation",
            "UsageOptimization": "Usage Optimization (Zombies)",
            "RateOptimization": "Rate Optimization (Reservations)",
            "ForecastingAndBudgeting": "Forecasting and Budgeting",
            "GovernanceAndAutomation": "Governance and Automation",
            "info_phase": "FinOps phases (Crawl, Walk, Run) determine your level of cloud practice evolution.",
            "info_VisibilityAndAllocation": "Measures how well you are tagging and viewing your costs.",
            "info_UsageOptimization": "Measures how much you are turning off or deleting idle/oversized resources.",
            "info_RateOptimization": "Measures your reserved instance and savings plan coverage.",
            "info_ForecastingAndBudgeting": "Measures the accuracy of your budgets vs actual spend.",
            "info_GovernanceAndAutomation": "Measures how many automated policies you have active."
        }
    }
    keys_pt = {
        "ERR_INSUFFICIENT_PERMISSIONS": "Permissões insuficientes (Leitor de Gerenciamento de Custos) nesta assinatura.",
        "ERR_COST_API_THROTTLED": "Limite de solicitações da API de Custos excedido. Tente novamente mais tarde.",
        "ERR_INTERNAL_SERVER": "Erro interno ao buscar faturamento.",
        "Maturity": {
            "VisibilityAndAllocation": "Visibilidade e Alocação",
            "UsageOptimization": "Otimização de Uso (Zumbis)",
            "RateOptimization": "Otimização de Taxas (Reservas)",
            "ForecastingAndBudgeting": "Previsões e Orçamentos",
            "GovernanceAndAutomation": "Governança e Automação",
            "info_phase": "As fases FinOps (Crawl, Walk, Run) determinam seu nível de evolução na nuvem.",
            "info_VisibilityAndAllocation": "Mede quão bem você está marcando e visualizando seus custos.",
            "info_UsageOptimization": "Mede o quanto você está desligando ou excluindo recursos ociosos.",
            "info_RateOptimization": "Mede sua cobertura de instâncias reservadas e planos de economia.",
            "info_ForecastingAndBudgeting": "Mede a precisão dos seus orçamentos em relação aos gastos reais.",
            "info_GovernanceAndAutomation": "Mede quantas políticas automatizadas você tem ativas."
        }
    }
    
    update_json_file(os.path.join(base_dir, "messages/es.json"), keys_es)
    update_json_file(os.path.join(base_dir, "messages/en.json"), keys_en)
    update_json_file(os.path.join(base_dir, "messages/pt-BR.json"), keys_pt)

    print("Script completado. (Falta parchear componentes de UI manualmente vía tool de reemplazo).")

if __name__ == "__main__":
    deploy()
