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

    // Insert or update legal acceptance record. Firma siempre con el email
    // real del token verificado (identity.email) — nunca con un valor que
    // mande el cliente — para que el registro legal sea confiable.
    await pool.query(
      `
      INSERT INTO LegalAcceptances (tenant_id, user_email, document_type, document_version, ip_address, user_agent)
      VALUES (?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE accepted_at = CURRENT_TIMESTAMP, ip_address = VALUES(ip_address), user_agent = VALUES(user_agent)
      `,
      [tenantId, identity.email, documentType, documentVersion, ipAddress, userAgent]
    );

    const [userRows] = await pool.query(
      `SELECT display_name FROM Users WHERE tenant_id = ? AND email = ? LIMIT 1`,
      [tenantId, identity.email]
    );
    const signedByName = (Array.isArray(userRows) && userRows.length > 0)
      ? (userRows[0] as { display_name: string | null }).display_name
      : null;

    return NextResponse.json({
      accepted_at: new Date().toISOString(),
      documentType,
      documentVersion,
      signedByEmail: identity.email,
      signedByName,
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

    // Check if document is accepted — join a Users para mostrar el nombre
    // del firmante además de su email (LegalAcceptances solo persiste email).
    const [rows] = await pool.query(
      `
      SELECT la.accepted_at, la.user_email, u.display_name
      FROM LegalAcceptances la
      LEFT JOIN Users u ON u.tenant_id = la.tenant_id AND u.email = la.user_email
      WHERE la.tenant_id = ? AND la.document_type = ? AND la.document_version = ?
      LIMIT 1
      `,
      [tenantId, documentType, documentVersion]
    );

    if (Array.isArray(rows) && rows.length > 0) {
      const row = rows[0] as { accepted_at: Date; user_email: string; display_name: string | null };
      return NextResponse.json({
        accepted: true,
        accepted_at: row.accepted_at.toISOString(),
        documentType,
        documentVersion,
        signedByEmail: row.user_email,
        signedByName: row.display_name,
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
