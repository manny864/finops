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

    // Fetch tenant's Azure credentials from DB
    const [tenantRows]: any = await pool.query(
      "SELECT client_id, client_secret FROM Tenants WHERE tenant_id = ?",
      [tenantId]
    );

    if (!tenantRows || tenantRows.length === 0 || !tenantRows[0].client_id) {
      return NextResponse.json({ error: "Tenant credentials no encontradas." }, { status: 404 });
    }

    const { client_id, client_secret } = tenantRows[0];

    // Request Access Token from Microsoft Graph
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
        // Fallback for development if Admin Consent hasn't been granted
        return NextResponse.json({ 
            error: "Fallo al obtener token de Microsoft Graph. ¿Se ha otorgado el Admin Consent?",
            details: tokenData
        }, { status: 403 });
    }

    const accessToken = tokenData.access_token;

    // Fetch Users from Microsoft Graph
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
        return NextResponse.json({ error: "No se pudo leer los usuarios de Microsoft Entra ID." }, { status: 500 });
    }

    const graphData = await graphRes.json();

    return NextResponse.json({ success: true, users: graphData.value });

  } catch (error: any) {
    console.error("[Entra ID Sync Error]", error);
    return NextResponse.json({ error: "Error interno del servidor." }, { status: 500 });
  }
}
