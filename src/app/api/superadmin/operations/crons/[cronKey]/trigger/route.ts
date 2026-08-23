/**
 * Endpoint para forzar la ejecución manual de un cron job de Azure (SuperAdmin).
 * Auth: requireSuperAdmin
 */

import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireSuperAdmin } from "@/lib/requestAuth";
import { errorMessage, errorStatus } from "@/lib/apiErrors";
import { triggerCronJob } from "@/services/superAdminOperations.service";
import { CronJobKey } from "@/types/saasOperations.types";

export async function POST(
    request: NextRequest,
    context: { params: Promise<{ cronKey: string }> }
) {
    try {
        const { searchParams } = new URL(request.url);
        const isMock = searchParams.get("mock") === "true";

        if (!isMock) {
            await requireSuperAdmin(request);
        }

        const { cronKey } = await context.params;

        if (!cronKey) {
            return NextResponse.json({ success: false, error: "Falta cronKey." }, { status: 400 });
        }

        const result = await triggerCronJob(cronKey as CronJobKey, isMock);
        return NextResponse.json(result);
    } catch (error) {
        if (error instanceof AuthError) {
            return NextResponse.json({ success: false, error: errorMessage(error) }, { status: errorStatus(error) });
        }
        return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 500 });
    }
}
