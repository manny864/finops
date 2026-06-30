import { NextRequest, NextResponse } from "next/server";
import { requireTenantRole } from "@/lib/requestAuth";
import pool from "@/modules/storage/db";

export async function GET(request: NextRequest) {
  try {
    const searchParams = new URL(request.url).searchParams;
    const tenantId = searchParams.get("tenantId");
    const limit = Math.min(parseInt(searchParams.get("limit") || "50"), 100);

    if (!tenantId) {
      return NextResponse.json({ error: "tenantId es requerido" }, { status: 400 });
    }

    await requireTenantRole(request, tenantId, ["OWNER"]);

    const [rows]: any = await pool.query(
      `SELECT 
        id,
        paddle_transaction_id as transactionId,
        paddle_subscription_id as subscriptionId,
        amount,
        currency,
        status,
        billed_at as billedAt,
        created_at as createdAt
      FROM BillingTransactions
      WHERE tenant_id = ?
      ORDER BY billed_at DESC, created_at DESC
      LIMIT ?`,
      [tenantId, limit]
    );

    const invoices = (Array.isArray(rows) ? rows : []).map((row: any) => ({
      id: row.id,
      transactionId: row.transactionId,
      subscriptionId: row.subscriptionId,
      amount: row.amount,
      currency: row.currency,
      status: row.status,
      billedAt: row.billedAt,
      createdAt: row.createdAt,
    }));

    return NextResponse.json({
      success: true,
      invoices,
      count: invoices.length,
    });
  } catch (error: any) {
    console.error("[Billing] GET /invoices error:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
