import os
import subprocess

base_dir = "/Users/manuelchavez/Documents/FinOpsProyect"

def run_db_migration():
    path = os.path.join(base_dir, "scripts/db_migrate.mjs")
    code = """import mysql from 'mysql2/promise';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env.development' });
dotenv.config({ path: '.env' });

async function run() {
    const pool = mysql.createPool({
        host: process.env.MYSQL_HOST,
        user: process.env.MYSQL_USER,
        password: process.env.MYSQL_PASSWORD,
        database: process.env.MYSQL_DATABASE,
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0
    });

    const query = `
        CREATE TABLE IF NOT EXISTS CostCenterBudgets (
            id INT AUTO_INCREMENT PRIMARY KEY,
            tenant_id VARCHAR(255) NOT NULL,
            cost_center_name VARCHAR(255) NOT NULL,
            monthly_budget_usd DECIMAL(10,2) NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY unique_tenant_costcenter (tenant_id, cost_center_name)
        )
    `;
    
    try {
        await pool.query(query);
        console.log("Tabla CostCenterBudgets verificada/creada con éxito.");
    } catch (e) {
        console.error("Error al crear tabla:", e);
    }
    process.exit(0);
}

run();
"""
    with open(path, "w") as f:
        f.write(code)
    
    # Executing the migration script
    os.chdir(base_dir)
    subprocess.run(["node", "scripts/db_migrate.mjs"], check=True)

def create_service():
    path = os.path.join(base_dir, "src/services/budgetService.ts")
    code = """import { getAzureCredential } from "@/lib/azure";
import { CostManagementClient } from "@azure/arm-costmanagement";

export async function getBudgetConsumption(tenantId: string, subscriptionId: string, costCenterName: string) {
    const credential = await getAzureCredential(tenantId);
    const client = new CostManagementClient(credential);
    const scope = `/subscriptions/${subscriptionId}`;

    try {
        const res = await client.query.usage(scope, {
            type: "Usage",
            timeframe: "MonthToDate",
            dataset: {
                granularity: "Monthly",
                aggregation: {
                    totalCost: { name: "PreTaxCost", function: "Sum" }
                },
                grouping: [],
                filter: {
                    tags: { name: "CostCenter", operator: "In", values: [costCenterName] }
                }
            }
        });

        if (res.rows && res.rows.length > 0 && res.rows[0].length > 0) {
            return parseFloat(res.rows[0][0] as string);
        }
        return 0;
    } catch (e) {
        console.error(`Error fetching cost for ${costCenterName}:`, e);
        return 0;
    }
}
"""
    with open(path, "w") as f:
        f.write(code)
    print("budgetService created.")

def create_api():
    api_dir = os.path.join(base_dir, "src/app/api/budgets")
    os.makedirs(api_dir, exist_ok=True)
    
    path = os.path.join(api_dir, "route.ts")
    code = """import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import jwt from "jsonwebtoken";

export async function GET(request: NextRequest) {
    try {
        const url = new URL(request.url);
        const tenantId = url.searchParams.get("tenantId");
        
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

        if (decoded.tid !== tenantId && !isAdmin) {
            return NextResponse.json({ error: "El token no coincide con el tenant." }, { status: 403 });
        }

        const [rows] = await pool.query(
            "SELECT * FROM CostCenterBudgets WHERE tenant_id = ?",
            [tenantId]
        );

        return NextResponse.json({ budgets: rows });

    } catch (e: any) {
        return NextResponse.json({ error: "Error interno", details: e.message }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { tenantId, costCenterName, monthlyBudgetUsd } = body;

        if (!tenantId || !costCenterName || monthlyBudgetUsd === undefined) {
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

        if (decoded.tid !== tenantId && !isAdmin) {
            return NextResponse.json({ error: "El token no coincide con el tenant." }, { status: 403 });
        }

        await pool.query(
            `INSERT INTO CostCenterBudgets (tenant_id, cost_center_name, monthly_budget_usd) 
             VALUES (?, ?, ?) 
             ON DUPLICATE KEY UPDATE monthly_budget_usd = ?`,
            [tenantId, costCenterName, monthlyBudgetUsd, monthlyBudgetUsd]
        );

        return NextResponse.json({ success: true, message: "Presupuesto guardado" });

    } catch (e: any) {
        return NextResponse.json({ error: "Error interno", details: e.message }, { status: 500 });
    }
}
"""
    with open(path, "w") as f:
        f.write(code)
        
    burn_dir = os.path.join(api_dir, "burn")
    os.makedirs(burn_dir, exist_ok=True)
    burn_path = os.path.join(burn_dir, "route.ts")
    
    burn_code = """import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getBudgetConsumption } from "@/services/budgetService";
import jwt from "jsonwebtoken";

export async function GET(request: NextRequest) {
    try {
        const url = new URL(request.url);
        const tenantId = url.searchParams.get("tenantId");
        const subscriptionId = url.searchParams.get("subscriptionId");
        
        if (!tenantId || !subscriptionId) {
            return NextResponse.json({ error: "Faltan tenantId o subscriptionId." }, { status: 400 });
        }

        const authHeader = request.headers.get("authorization");
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return NextResponse.json({ error: "No autorizado." }, { status: 401 });
        }

        const [rows] = await pool.query(
            "SELECT cost_center_name, monthly_budget_usd FROM CostCenterBudgets WHERE tenant_id = ?",
            [tenantId]
        );

        const budgets = rows as any[];
        
        const burnData = await Promise.all(budgets.map(async (b) => {
            const actualCost = await getBudgetConsumption(tenantId, subscriptionId, b.cost_center_name);
            return {
                costCenter: b.cost_center_name,
                budget: parseFloat(b.monthly_budget_usd),
                actual: actualCost
            };
        }));

        return NextResponse.json({ burnData });

    } catch (e: any) {
        return NextResponse.json({ error: "Error interno", details: e.message }, { status: 500 });
    }
}
"""
    with open(burn_path, "w") as f:
        f.write(burn_code)
    print("APIs created.")

def create_widget():
    path = os.path.join(base_dir, "src/components/dashboard/BudgetBurnChart.tsx")
    code = """"use client";
import React, { useState, useEffect } from 'react';
import { useMsal } from '@azure/msal-react';
import { useTenant } from '../TenantProvider';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, CartesianGrid } from 'recharts';

export default function BudgetBurnChart() {
    const { instance, accounts } = useMsal();
    const { selectedTenant, subscriptions } = useTenant();
    const [burnData, setBurnData] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (accounts.length === 0 || selectedTenant.id === 'default' || subscriptions.length === 0) return;
        
        const fetchBurnData = async () => {
            setLoading(true);
            try {
                const tokenResponse = await instance.acquireTokenSilent({
                    scopes: ["User.Read"],
                    account: accounts[0]
                });
                
                const subId = subscriptions[0].subscriptionId;
                
                const res = await fetch(`/api/budgets/burn?tenantId=${selectedTenant.id}&subscriptionId=${subId}`, {
                    headers: { 'Authorization': `Bearer ${tokenResponse.idToken}` }
                });
                const json = await res.json();
                if (json.burnData) {
                    setBurnData(json.burnData);
                }
            } catch (e) {
                console.error("Error fetching budget burn data:", e);
            }
            setLoading(false);
        };
        fetchBurnData();
    }, [accounts, instance, selectedTenant.id, subscriptions]);

    if (accounts.length === 0 || selectedTenant.id === 'default') return null;

    return (
        <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-6 mt-6">
            <h3 className="text-lg font-bold text-gray-800 mb-2">Presupuesto por Centro de Costos</h3>
            <p className="text-sm text-gray-500 mb-4">Muestra el límite asignado vs el gasto amortizado actual.</p>
            
            {loading ? (
                <div className="h-64 flex items-center justify-center">
                    <div className="text-sm text-gray-400 animate-pulse">Analizando Azure Cost Management...</div>
                </div>
            ) : burnData.length === 0 ? (
                <div className="text-sm text-gray-400 h-64 flex flex-col items-center justify-center text-center">
                    No hay presupuestos configurados para este Tenant.<br/>
                    Utiliza la API de Presupuestos para configurarlos.
                </div>
            ) : (
                <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={burnData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} />
                            <XAxis dataKey="costCenter" />
                            <YAxis tickFormatter={(val) => `$${val}`} />
                            <Tooltip formatter={(val: number) => `$${val.toFixed(2)} USD`} />
                            
                            <Bar dataKey="budget" name="Presupuesto Asignado" fill="#e5e7eb" radius={[4, 4, 0, 0]} />
                            <Bar dataKey="actual" name="Gasto Actual" radius={[4, 4, 0, 0]}>
                                {burnData.map((entry, index) => {
                                    const ratio = entry.budget > 0 ? entry.actual / entry.budget : 0;
                                    const color = ratio >= 0.8 ? '#ef4444' : '#10b981';
                                    return <Cell key={`cell-${index}`} fill={color} />;
                                })}
                            </Bar>
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            )}
        </div>
    );
}
"""
    with open(path, "w") as f:
        f.write(code)
    print("Widget created.")

def update_page():
    path = os.path.join(base_dir, "src/app/page.tsx")
    with open(path, "r") as f:
        content = f.read()

    if "import BudgetBurnChart" not in content:
        content = content.replace(
            'import PowerSchedules from "@/components/dashboard/PowerSchedules";',
            'import PowerSchedules from "@/components/dashboard/PowerSchedules";\\nimport BudgetBurnChart from "@/components/dashboard/BudgetBurnChart";'
        )

    if "<BudgetBurnChart />" not in content:
        # Wrap it after PowerSchedules
        content = content.replace(
            "<PowerSchedules />\\n        </div>",
            "<PowerSchedules />\\n        <BudgetBurnChart />\\n        </div>"
        )
        
    with open(path, "w") as f:
        f.write(content)
    print("page.tsx updated.")

def update_sop():
    path = os.path.join(base_dir, "directivas/budget_schedules_SOP.md")
    with open(path, "w") as f:
        f.write("# Tag-Based Budgets SOP\\n\\n")
        f.write("- **Servicio**: `budgetService.ts` invoca `CostManagementClient.query.usage` filtrando por el tag `CostCenter`.\\n")
        f.write("- **API**: `/api/budgets/burn` orquesta la unión entre los límites de DB (MySQL) y el consumo reportado (Azure API).\\n")

if __name__ == "__main__":
    run_db_migration()
    create_service()
    create_api()
    create_widget()
    update_page()
    update_sop()
    print("Feature deploy completo.")
