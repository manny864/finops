import { NextRequest, NextResponse } from "next/server";
import pool from "@/modules/storage/db";
import { requireTenantRole, AuthError } from "@/lib/requestAuth";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { tenantId, company_name } = body;

    if (!tenantId) {
      return NextResponse.json(
        { error: "tenantId required" },
        { status: 400 }
      );
    }

    // Verify tenant access (admin/owner only)
    const identity = await requireTenantRole(request, tenantId, ["Owner", "OWNER", "Admin", "ADMIN"]);

    // Create a compliance request record (placeholder for ticket system)
    // In production, this would integrate with Zendesk, Jira, etc.
    const requestedAt = new Date().toISOString();
    
    console.log(`[SOC 2 Request] From: ${company_name} (${tenantId}) | Email: ${identity.email} | Time: ${requestedAt}`);
    
    // Send notification email to support
    try {
      // In production, use emailHelper or integration with mail service
      console.log(`[NOTIFICATION] SOC 2 request from ${company_name}: ${identity.email}`);
    } catch (emailErr) {
      console.error("Failed to send notification email:", emailErr);
      // Don't fail the request if email fails
    }

    return NextResponse.json({
      success: true,
      message: "SOC 2 report request submitted",
      requested_at: requestedAt,
      tenantId,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status }
      );
    }
    console.error("Error requesting SOC 2 report:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
