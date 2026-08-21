import { NextRequest, NextResponse } from "next/server";
import pool, { initializeDatabase } from "@/modules/storage/db";
import { requireRequestIdentity, AuthError } from "@/lib/requestAuth";
import { errorMessage, errorStatus, serverError } from '@/lib/apiErrors';

export async function GET(request: NextRequest) {
    try {
        await initializeDatabase();

        const identity = await requireRequestIdentity(request);
        const tenantId = identity.tenantId;

        const connection = await pool.getConnection();
        try {
            const [rows] = await connection.query(
                'SELECT * FROM OnboardingProgress WHERE tenant_id = ?',
                [tenantId]
            ) as any[];

            if (rows.length === 0) {
                // Return defaults for new tenants
                return NextResponse.json({
                    tenant_id: tenantId,
                    step_welcome: "pending",
                    step_azure_sp: "pending",
                    step_first_sync: "pending",
                    step_first_budget: "pending",
                    step_notifications: "pending",
                    completed_at: null,
                    percent_complete: 0,
                });
            }

            const progress = rows[0];
            const percent = computePercent(progress);

            return NextResponse.json({
                ...progress,
                percent_complete: percent,
            });
        } finally {
            connection.release();
        }
    } catch (error) {
        console.error("[Onboarding Progress API] Error:", error);
        if (error instanceof AuthError) {
            return NextResponse.json({ error: errorMessage(error) }, { status: errorStatus(error) });
        }
        return serverError(error, { message: "Internal Server Error", status: 500 });
    }
}

function computePercent(progress: any): number {
    const steps = [
        progress.step_welcome,
        progress.step_azure_sp,
        progress.step_first_sync,
        progress.step_first_budget,
        progress.step_notifications,
    ];

    const completedOrSkipped = steps.filter(
        (s) => s === "completed" || s === "skipped"
    ).length;

    return Math.round((completedOrSkipped / steps.length) * 100);
}

export async function PUT(request: NextRequest) {
    try {
        await initializeDatabase();

        const identity = await requireRequestIdentity(request);
        const tenantId = identity.tenantId;

        const body = await request.json();
        const { step, status } = body;

        // Validate step name
        const validSteps = [
            "step_welcome",
            "step_azure_sp",
            "step_first_sync",
            "step_first_budget",
            "step_notifications",
        ];

        if (!validSteps.includes(step)) {
            return NextResponse.json({ error: "Invalid step name" }, { status: 400 });
        }

        // Validate status
        const validStatuses = ["pending", "in_progress", "completed", "skipped"];
        if (!validStatuses.includes(status)) {
            return NextResponse.json({ error: "Invalid status" }, { status: 400 });
        }

        const connection = await pool.getConnection();
        try {
            // Ensure row exists
            await connection.query(
                `INSERT IGNORE INTO OnboardingProgress (tenant_id) VALUES (?)`,
                [tenantId]
            );

            // Update the step
            await connection.query(
                `UPDATE OnboardingProgress SET ?? = ?, updated_at = NOW() WHERE tenant_id = ?`,
                [step, status, tenantId]
            );

            // Fetch updated row
            const [rows] = await connection.query(
                'SELECT * FROM OnboardingProgress WHERE tenant_id = ?',
                [tenantId]
            ) as any[];

            const progress = rows[0];
            const percent = computePercent(progress);

            return NextResponse.json({
                ...progress,
                percent_complete: percent,
            });
        } finally {
            connection.release();
        }
    } catch (error) {
        console.error("[Onboarding Progress PUT API] Error:", error);
        if (error instanceof AuthError) {
            return NextResponse.json({ error: errorMessage(error) }, { status: errorStatus(error) });
        }
        return serverError(error, { message: "Internal Server Error", status: 500 });
    }
}
