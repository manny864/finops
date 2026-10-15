import { NextRequest, NextResponse } from "next/server";
import { escapeHtml } from "@/lib/htmlEscape";
import rateLimiter from "@/lib/rateLimiter";
import { trustedClientIp } from "@/lib/trustedClientIp";

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { fullName, email, company, spend, requirements } = body;

        // Validación de campos + rate limit por IP: antes este endpoint no
        // tenía ninguna, a diferencia de leads/demo/route.ts (que sí exige
        // reCAPTCHA). Permitía spamear el buzón de ventas con requests vacíos/
        // basura, cada uno disparando un envío real vía MS Graph.
        if (!fullName || !email || !company) {
            return NextResponse.json({ success: false, error: "Faltan campos obligatorios" }, { status: 400 });
        }
        if (!/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(String(email))) {
            return NextResponse.json({ success: false, error: "Email inválido" }, { status: 400 });
        }
        // PERIM-05: sólo la IP del proxy confiable; X-Forwarded-For lo elige quien
        // llama. Sin contrato de proxy, todos comparten un bucket. El tope global
        // acota los envíos reales por MS Graph aunque se roten IPs.
        const ip = trustedClientIp(req) ?? 'untrusted';
        // Distribuido (Redis) en vez de en memoria: per-proceso permitía
        // saltear el límite escalando horizontalmente o reiniciando el
        // contenedor (degrada a memoria si Redis no responde, ver rateLimiter.ts).
        const HOUR = 60 * 60 * 1000;
        const [rl, global] = await Promise.all([
            rateLimiter.checkByKeyDistributed(`leads:enterprise:${ip}`, 5, HOUR), // 5/hora por IP
            rateLimiter.checkByKeyDistributed('leads:enterprise:global', 50, HOUR),
        ]);
        if (!rl.allowed || !global.allowed) {
            return NextResponse.json({ success: false, error: "Demasiadas solicitudes. Intenta más tarde." }, { status: 429 });
        }

        // 1. Fetch MS Graph Token
        const tokenResponse = await fetch(`https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}/oauth2/v2.0/token`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
                client_id: process.env.AZURE_CLIENT_ID || '',
                scope: 'https://graph.microsoft.com/.default',
                client_secret: process.env.AZURE_CLIENT_SECRET || '',
                grant_type: 'client_credentials'
            })
        });

        if (!tokenResponse.ok) {
            console.error("[Leads] Failed to fetch MS Graph Token", await tokenResponse.text());
            throw new Error("Failed to authenticate with MS Graph");
        }

        const tokenData = await tokenResponse.json();
        const accessToken = tokenData.access_token;

        // 2. Construct Email Payload — HTML escape all user-controlled inputs
        const safeName = escapeHtml(fullName);
        const safeEmail = escapeHtml(email);
        const safeCompany = escapeHtml(company);
        const safeSpend = escapeHtml(spend);
        const safeRequirements = escapeHtml(requirements || "N/A").replace(/\n/g, '<br/>');
        const mailPayload = {
            message: {
                subject: `🚨 NUEVO LEAD ENTERPRISE - FinOps: ${safeCompany}`,
                body: {
                    contentType: "HTML",
                    content: `
                        <h2>Nuevo Lead Enterprise Capturado</h2>
                        <p><strong>Nombre:</strong> ${safeName}</p>
                        <p><strong>Email:</strong> ${safeEmail}</p>
                        <p><strong>Empresa:</strong> <span style="font-size: 1.2em; color: #0054A6;">${safeCompany}</span></p>
                        <p><strong>Gasto Mensual Cloud:</strong> <strong style="font-size: 1.1em; color: #D32F2F;">${safeSpend}</strong></p>
                        <p><strong>Requerimientos:</strong><br/>${safeRequirements}</p>
                    `
                },
                toRecipients: [
                    {
                        emailAddress: {
                            address: process.env.AZURE_RECIPIENT_EMAIL || process.env.CONTACT_EMAIL_RECIPIENT || 'sales@cscloudsolutions.com.ar'
                        }
                    }
                ]
            },
            saveToSentItems: "false"
        };

        // 3. Send Email via MS Graph
        const sender = process.env.AZURE_SENDER_EMAIL || process.env.CONTACT_EMAIL_SENDER;
        
        if (!sender) {
            throw new Error("Sender email is not configured in environment variables.");
        }

        const sendResponse = await fetch(`https://graph.microsoft.com/v1.0/users/${sender}/sendMail`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(mailPayload)
        });

        if (!sendResponse.ok) {
            console.error("[Leads] Failed to send email", await sendResponse.text());
            throw new Error("Failed to send email via MS Graph");
        }

        console.log(`[Leads] Email successfully sent for lead: ${company}`);
        return NextResponse.json({ success: true, message: "Lead captured successfully" });

    } catch (error) {
        console.error("[Leads] Error processing lead", error);
        return NextResponse.json({ success: false, error: "Internal Server Error" }, { status: 500 });
    }
}
