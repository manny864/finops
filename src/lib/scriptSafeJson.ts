import { NextResponse } from "next/server";
import { guardScripts } from "@/lib/shellSafe";

/** NextResponse.json con guard de commandPayload (AISEC-01). */
export const scriptSafeJson = <T>(data: T, init?: ResponseInit) => NextResponse.json(guardScripts(data), init);
