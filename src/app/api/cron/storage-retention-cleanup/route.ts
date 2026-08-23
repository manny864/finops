import { NextRequest, NextResponse } from "next/server";
import { executeStorageRetentionCleanup } from "@/services/storageRetentionCleaner.service";

export const dynamic = "force-dynamic";

function validateCronAuth(request: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || cronSecret.length < 16) {
    if (process.env.NODE_ENV === "development") return true;
    console.error("[storage-retention-cleanup] CRON_SECRET no está configurado o es demasiado corto.");
    return false;
  }

  const authHeader = request.headers.get("authorization");
  const xCronSecret = request.headers.get("x-cron-secret");

  if (authHeader === `Bearer ${cronSecret}` || xCronSecret === cronSecret) {
    return true;
  }

  return false;
}

export async function POST(request: NextRequest) {
  try {
    if (!validateCronAuth(request)) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const dryRun = searchParams.get("dryRun") === "true";

    const result = await executeStorageRetentionCleanup({ dryRun });
    return NextResponse.json(result);
  } catch (error: any) {
    console.error("[api/cron/storage-retention-cleanup] Error en POST:", error);
    return NextResponse.json(
      { success: false, error: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    if (!validateCronAuth(request)) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const dryRun = searchParams.get("dryRun") === "true";

    const result = await executeStorageRetentionCleanup({ dryRun });
    return NextResponse.json(result);
  } catch (error: any) {
    console.error("[api/cron/storage-retention-cleanup] Error en GET:", error);
    return NextResponse.json(
      { success: false, error: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
