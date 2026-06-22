import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import pool from "@/modules/storage/db";

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Falta token Bearer de autenticación." }, { status: 401 });
    }

    const token = authHeader.split(" ")[1];
    const decoded = jwt.decode(token) as any;

    if (!decoded || !decoded.tid) {
      return NextResponse.json({ error: "Token inválido." }, { status: 401 });
    }

    const tenantId = decoded.tid;

    // Step A: DB Check
    const [tenantRows]: any = await pool.query(
      "SELECT client_id, client_secret FROM Tenants WHERE tenant_id = ?",
      [tenantId]
    );

    if (!tenantRows || tenantRows.length === 0 || !tenantRows[0].client_id || !tenantRows[0].client_secret) {
      const err: any = new Error('Missing Azure credentials in database');
      err.status = 400;
      throw err;
    }

    const { client_id, client_secret } = tenantRows[0];

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

  } catch (error: any) {
    console.error("[Entra ID Sync Error]", error.stack || error);
    return NextResponse.json({ 
        error: error.message || "Error interno al sincronizar Entra ID",
        details: error.details || null
    }, { status: error.status || 500 });
  }
}
