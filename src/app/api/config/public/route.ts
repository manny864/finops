import { NextResponse } from "next/server";
import { getPublicRuntimeConfig } from "@/lib/publicRuntimeConfig";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(getPublicRuntimeConfig(), {
    headers: { "Cache-Control": "private, no-store" },
  });
}
