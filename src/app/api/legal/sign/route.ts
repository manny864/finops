import { NextRequest, NextResponse } from "next/server";
import pool from "@/modules/storage/db";
import { requireTenantRole, AuthError } from "@/lib/requestAuth";
import { LEGAL_VERSIONS, type LegalDocumentType } from "@/lib/legalVersions";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { documentType } = body;

    if (!documentType || !Object.keys(LEGAL_VERSIONS).includes(documentType)) {
      return NextResponse.json(
        { error: "Invalid documentType. Must be one of: dpa, terms, privacy" },
        { status: 400 }
      );
    }

    // Get tenant from query params or request body
    const tenantId = request.nextUrl.searchParams.get("tenantId");
    if (!tenantId) {
      return NextResponse.json(
        { error: "tenantId parameter required" },
        { status: 400 }
      );
    }

    // Require OWNER role to sign legal docs
    const identity = await requireTenantRole(request, tenantId, ["Owner", "OWNER", "Admin", "ADMIN"]);

    const documentVersion = LEGAL_VERSIONS[documentType as LegalDocumentType];
    const ipAddress = request.headers.get("x-forwarded-for") || request.headers.get("x-client-ip") || "unknown";
    const userAgent = request.headers.get("user-agent") || "";

    // Insert or update legal acceptance record
    await pool.query(
      `
      INSERT INTO LegalAcceptances (tenant_id, user_email, document_type, document_version, ip_address, user_agent)
      VALUES (?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE accepted_at = CURRENT_TIMESTAMP, ip_address = VALUES(ip_address), user_agent = VALUES(user_agent)
      `,
      [tenantId, identity.email, documentType, documentVersion, ipAddress, userAgent]
    );

    return NextResponse.json({
      accepted_at: new Date().toISOString(),
      documentType,
      documentVersion,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status }
      );
    }
    console.error("Error signing legal document:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const tenantId = request.nextUrl.searchParams.get("tenantId");
    const documentType = request.nextUrl.searchParams.get("documentType");

    if (!tenantId) {
      return NextResponse.json(
        { error: "tenantId parameter required" },
        { status: 400 }
      );
    }

    if (!documentType || !Object.keys(LEGAL_VERSIONS).includes(documentType)) {
      return NextResponse.json(
        { error: "Invalid documentType. Must be one of: dpa, terms, privacy" },
        { status: 400 }
      );
    }

    // Verify access to this tenant
    const identity = await requireTenantRole(request, tenantId, ["Owner", "OWNER", "Admin", "ADMIN"]);

    const documentVersion = LEGAL_VERSIONS[documentType as LegalDocumentType];

    // Check if document is accepted
    const [rows] = await pool.query(
      `
      SELECT accepted_at FROM LegalAcceptances
      WHERE tenant_id = ? AND document_type = ? AND document_version = ?
      LIMIT 1
      `,
      [tenantId, documentType, documentVersion]
    );

    if (Array.isArray(rows) && rows.length > 0) {
      const row = rows[0] as { accepted_at: Date };
      return NextResponse.json({
        accepted: true,
        accepted_at: row.accepted_at.toISOString(),
        documentType,
        documentVersion,
      });
    }

    return NextResponse.json({
      accepted: false,
      documentType,
      documentVersion,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status }
      );
    }
    console.error("Error checking legal document acceptance:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
