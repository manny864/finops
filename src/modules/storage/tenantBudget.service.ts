import pool from './db';
import { RowDataPacket } from 'mysql2/promise';
import { toMoneyNumber } from '@/lib/money';

export interface TenantBudget {
    id?: number;
    tenant_id: string;
    budget_month: number;
    budget_year: number;
    budget_usd: number;
    alert_threshold: number;
}

export async function upsertTenantBudget(
    tenant_id: string, 
    month: number, 
    year: number, 
    budget_usd: number, 
    alert_threshold: number = 80.00
): Promise<void> {
    await pool.query(
        `INSERT INTO TenantMonthlyBudgets (tenant_id, budget_month, budget_year, budget_usd, alert_threshold)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE 
            budget_usd = VALUES(budget_usd),
            alert_threshold = VALUES(alert_threshold)`,
        [tenant_id, month, year, budget_usd, alert_threshold]
    );
}

export async function getTenantBudgetByPeriod(
    tenant_id: string, 
    month: number, 
    year: number
): Promise<TenantBudget | null> {
    const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT id, tenant_id, budget_month, budget_year, budget_usd, alert_threshold 
         FROM TenantMonthlyBudgets 
         WHERE tenant_id = ? AND budget_month = ? AND budget_year = ?`,
        [tenant_id, month, year]
    );

    if (rows.length === 0) return null;
    
    const row = rows[0];
    return {
        id: row.id,
        tenant_id: row.tenant_id,
        budget_month: row.budget_month,
        budget_year: row.budget_year,
        budget_usd: toMoneyNumber(row.budget_usd),
        alert_threshold: toMoneyNumber(row.alert_threshold)
    };
}
