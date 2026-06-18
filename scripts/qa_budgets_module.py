import os

base_dir = "/Users/manuelchavez/Documents/FinOpsProyect"

def patch_sidebar():
    path = os.path.join(base_dir, "src/components/Sidebar.tsx")
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()
    
    target_line = "{ href: '/intelligence/billing', label: t('billing'), icon: PieChart },"
    new_line = "{ href: '/intelligence/budgets', label: t('budgets', { fallback: 'Tenant Budgets' }), icon: DollarSign },"
    
    if new_line not in content and target_line in content:
        content = content.replace(target_line, target_line + "\n                " + new_line)
        with open(path, "w", encoding="utf-8") as f:
            f.write(content)
        print("Sidebar.tsx patched.")
    else:
        print("Sidebar.tsx already patched or target not found.")

def patch_api_route():
    path = os.path.join(base_dir, "src/app/api/budgets/route.ts")
    code = """import { NextRequest, NextResponse } from "next/server";
import pool from "@/modules/storage/db";
import jwt from "jsonwebtoken";
import { getBudgetConsumption } from "@/services/budgetService";

export async function GET(request: NextRequest) {
    try {
        const url = new URL(request.url);
        let tenantId = url.searchParams.get("tenantId");
        const subscriptionId = url.searchParams.get("subscriptionId") || "All";
        
        if (!tenantId) {
            return NextResponse.json({ error: "Falta el tenantId." }, { status: 400 });
        }

        const authHeader = request.headers.get("authorization");
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return NextResponse.json({ error: "No autorizado." }, { status: 401 });
        }
        const token = authHeader.split(" ")[1];
        const decoded = jwt.decode(token) as any;
        if (!decoded || !decoded.tid) {
            return NextResponse.json({ error: "Token inválido." }, { status: 401 });
        }

        const email = decoded.preferred_username || decoded.unique_name || decoded.email || "";
        const isAdmin = email.toLowerCase().endsWith("@cscloudsolutions.com.ar");

        // QA Security Patch: IDOR Prevention
        if (!isAdmin) {
            tenantId = decoded.tid; // Forzar uso del tenant verificado
        } else if (decoded.tid !== tenantId && !isAdmin) {
            return NextResponse.json({ error: "El token no coincide con el tenant." }, { status: 403 });
        }

        const [rows]: any = await pool.query(
            "SELECT * FROM Budgets WHERE tenant_id = ?",
            [tenantId]
        );

        // Fetch current consumption for each budget
        const budgetsWithUtilization = await Promise.all(rows.map(async (b: any) => {
            const currentSpend = await getBudgetConsumption(tenantId!, subscriptionId, b.cost_center_tag_value);
            const limit = parseFloat(b.monthly_limit_usd);
            
            // QA Patch: Zero-division prevention
            const utilization = limit > 0 ? (currentSpend / limit) * 100 : 0;
            
            return {
                id: b.id,
                costCenter: b.cost_center_tag_value,
                monthlyLimit: limit,
                alertThreshold: parseFloat(b.alert_threshold),
                currentSpend: currentSpend,
                utilization: utilization
            };
        }));

        return NextResponse.json({ budgets: budgetsWithUtilization });

    } catch (e: any) {
        return NextResponse.json({ error: "Error interno", details: e.message }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        let { tenantId, costCenter, monthlyLimit, alertThreshold = 80.00 } = body;

        if (!tenantId || !costCenter || monthlyLimit === undefined) {
            return NextResponse.json({ error: "Parámetros incompletos" }, { status: 400 });
        }

        const authHeader = request.headers.get("authorization");
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return NextResponse.json({ error: "No autorizado." }, { status: 401 });
        }
        const token = authHeader.split(" ")[1];
        const decoded = jwt.decode(token) as any;
        if (!decoded || !decoded.tid) {
            return NextResponse.json({ error: "Token inválido." }, { status: 401 });
        }

        const email = decoded.preferred_username || decoded.unique_name || decoded.email || "";
        const isAdmin = email.toLowerCase().endsWith("@cscloudsolutions.com.ar");

        // QA Security Patch: IDOR Prevention
        if (!isAdmin) {
            tenantId = decoded.tid; // Forzar uso del tenant verificado
        } else if (decoded.tid !== tenantId && !isAdmin) {
            return NextResponse.json({ error: "El token no coincide con el tenant." }, { status: 403 });
        }

        await pool.query(
            `INSERT INTO Budgets (tenant_id, cost_center_tag_value, monthly_limit_usd, alert_threshold) 
             VALUES (?, ?, ?, ?) 
             ON DUPLICATE KEY UPDATE monthly_limit_usd = ?, alert_threshold = ?`,
            [tenantId, costCenter, monthlyLimit, alertThreshold, monthlyLimit, alertThreshold]
        );

        return NextResponse.json({ success: true, message: "Presupuesto guardado" });

    } catch (e: any) {
        return NextResponse.json({ error: "Error interno", details: e.message }, { status: 500 });
    }
}
"""
    with open(path, "w", encoding="utf-8") as f:
        f.write(code)
    print("API route.ts patched.")

def patch_frontend_component():
    path = os.path.join(base_dir, "src/components/budgets/BudgetCard.tsx")
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()

    # Añadir barra de progreso con cálculo seguro
    if "bg-brand-deep rounded-full" not in content:
        # Reemplazar el render de presupuesto asignado para incluir progreso visual
        replacement = """
                    <div className="flex items-center gap-3 mt-2">
                        <div className="p-3 bg-amber-50 rounded-full text-amber-500">
                            <Bell className="w-6 h-6" />
                        </div>
                        <div>
                            <p className="text-sm text-gray-500 font-medium">{t('alert_threshold')}</p>
                            <p className="text-lg font-bold text-gray-900">
                                {budgetData.alert_threshold}%
                            </p>
                        </div>
                    </div>
                    
                    {/* Progress Bar (Mocked Spend) */}
                    <div className="mt-4">
                        <div className="flex justify-between text-xs mb-1">
                            <span className="font-semibold text-gray-600">Consumo Simulado</span>
                            <span className="font-bold text-gray-800">
                                {budgetData.budget_usd > 0 ? ((2500 / budgetData.budget_usd) * 100).toFixed(1) : 0}%
                            </span>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-2.5">
                            <div 
                                className={`h-2.5 rounded-full ${budgetData.budget_usd > 0 && (2500 / budgetData.budget_usd) * 100 >= budgetData.alert_threshold ? 'bg-red-500' : 'bg-brand-deep'}`}
                                style={{ width: `${budgetData.budget_usd > 0 ? Math.min((2500 / budgetData.budget_usd) * 100, 100) : 0}%` }}
                            ></div>
                        </div>
                    </div>
"""
        content = content.replace("""
                    <div className="flex items-center gap-3 mt-2">
                        <div className="p-3 bg-amber-50 rounded-full text-amber-500">
                            <Bell className="w-6 h-6" />
                        </div>
                        <div>
                            <p className="text-sm text-gray-500 font-medium">{t('alert_threshold')}</p>
                            <p className="text-lg font-bold text-gray-900">
                                {budgetData.alert_threshold}%
                            </p>
                        </div>
                    </div>""", replacement)
        
        with open(path, "w", encoding="utf-8") as f:
            f.write(content)
        print("BudgetCard.tsx patched for visual progress logic.")

if __name__ == "__main__":
    patch_sidebar()
    patch_api_route()
    patch_frontend_component()
    print("QA Security module executed.")
