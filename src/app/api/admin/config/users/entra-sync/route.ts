import { NextRequest, NextResponse } from "next/server";
import { requireRequestIdentity, requireTenantRole, AuthError } from "@/lib/requestAuth";
import { getTenantCredentials } from "@/lib/secrets/tenantCredentials";

export async function GET(request: NextRequest) {
  try {
    const tmpIdentity = await requireRequestIdentity(request);
    const tenantId = tmpIdentity.tenantId;
    await requireTenantRole(request, tenantId, ['Admin', 'Owner']);

    // Step A: KV (with DB fallback)
    const creds = await getTenantCredentials(tenantId);

    if (!creds) {
      const err: any = new Error('Missing Azure credentials in Key Vault / database');
      err.status = 400;
      throw err;
    }

    const { clientId: client_id, clientSecret: client_secret } = creds;

    // Step B: Token Fetch
    const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
    const tokenParams = new URLSearchParams({
      client_id: client_id,
      client_secret: client_secret,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials'
    });

    const tokenRes = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: tokenParams
    });

    const tokenData = await tokenRes.json();

    if (!tokenRes.ok || !tokenData.access_token) {
        console.error("Error getting Graph access token:", tokenData);
        const err: any = new Error(tokenData.error_description || tokenData.error || 'Fallo al obtener token de Microsoft Graph');
        err.status = 401;
        err.details = tokenData;
        throw err;
    }

    const accessToken = tokenData.access_token;

    // Step C: Graph API Fetch
    const graphUrl = "https://graph.microsoft.com/v1.0/users?$select=id,displayName,mail,userPrincipalName";
    const graphRes = await fetch(graphUrl, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });

    if (!graphRes.ok) {
        const graphError = await graphRes.json();
        console.error("Error fetching users from Graph:", graphError);
        const errMessage = graphError.error?.message || "No se pudo leer los usuarios de Microsoft Entra ID.";
        const err: any = new Error(errMessage);
        err.status = graphRes.status;
        err.details = graphError;
        throw err;
    }

    const graphData = await graphRes.json();

    return NextResponse.json({ success: true, users: graphData.value });

  } catch (error: unknown) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("[Entra ID Sync Error]", error);
    const err = error as { status?: number; message?: string; details?: unknown };
    return NextResponse.json({ 
        error: err.message || "Internal server error",
        details: err.details || null
    }, { status: err.status || 500 });
  }
}
