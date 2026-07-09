import { NextRequest, NextResponse } from "next/server";
import { escapeHtml } from "@/lib/htmlEscape";
import { getInfraSecret } from "@/lib/secrets/infraSecrets";

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { fullName, email, phone, companyName, recaptchaToken } = body;

        if (!fullName || !email || !phone || !companyName || !recaptchaToken) {
            return NextResponse.json({ success: false, error: "Faltan campos obligatorios" }, { status: 400 });
        }

        // 1. Validate reCAPTCHA v3
        // Secret resuelto vía infraSecrets: Key Vault (infra-recaptcha-secret)
        // primero, RECAPTCHA_SECRET del .env como fallback.
        // Bypass de desarrollo: sin secret local no hay forma de resolver
        // un token real (el site key está hardcodeado en DemoLeadModal.tsx para el
        // dominio de producción). Fuera de development seguimos fail-closed.
        const isDev = process.env.NODE_ENV !== 'production';
        const recaptchaSecret = await getInfraSecret("recaptcha-secret");
        if (!recaptchaSecret && !isDev) {
            console.error('[Demo Lead] RECAPTCHA_SECRET not configured');
            return NextResponse.json({ success: false, error: "Service misconfigured" }, { status: 503 });
        }
        let recaptchaResult: { success?: boolean; score?: number } = {};
        if (recaptchaSecret) {
            const recaptchaVerify = await fetch(`https://www.google.com/recaptcha/api/siteverify`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: `secret=${encodeURIComponent(recaptchaSecret)}&response=${encodeURIComponent(recaptchaToken)}`
            });

            recaptchaResult = await recaptchaVerify.json();

            if (!recaptchaResult.success || (recaptchaResult.score ?? 0) < 0.5) {
                console.error("[Demo Lead] reCAPTCHA failed:", recaptchaResult);
                return NextResponse.json({ success: false, error: "Fallo de validación de seguridad (reCAPTCHA)" }, { status: 400 });
            }
        } else {
            console.warn('[Demo Lead] DEV bypass: RECAPTCHA_SECRET no configurado, se omite la verificación');
        }

        // Bypass de desarrollo: no pegarle a MS Graph con las credenciales reales
        // de la plataforma (.env.development las trae) para no mandar un email real
        // a sales@ por cada prueba local.
        if (isDev && !recaptchaSecret) {
            console.log(`[Demo Lead] DEV bypass: no se envía email real. Lead: ${JSON.stringify({ fullName, email, phone, companyName })}`);
            return NextResponse.json({ success: true, message: "Lead captured successfully (dev bypass, no email sent)" });
        }

        // 2. Fetch MS Graph Token
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
            console.error("[Demo Lead] Failed to fetch MS Graph Token", await tokenResponse.text());
            throw new Error("Failed to authenticate with MS Graph");
        }

        const tokenData = await tokenResponse.json();
        const accessToken = tokenData.access_token;

        // 3. Construct Email Payload — HTML escape all user-controlled inputs
        const safeName = escapeHtml(fullName);
        const safeEmail = escapeHtml(email);
        const safePhone = escapeHtml(phone);
        const safeCompany = escapeHtml(companyName);
        const mailPayload = {
            message: {
                subject: `🚨 NUEVO LEAD DEMO - FinOps: ${safeCompany}`,
                body: {
                    contentType: "HTML",
                    content: `
                        <h2>Nuevo Lead Capturado en Demo Gate</h2>
                        <p><strong>Nombre Completo:</strong> ${safeName}</p>
                        <p><strong>Correo Electrónico:</strong> ${safeEmail}</p>
                        <p><strong>Teléfono:</strong> ${safePhone}</p>
                        <p><strong>Nombre empresa:</strong> <span style="font-size: 1.2em; color: #0054A6;">${safeCompany}</span></p>
                        <p><strong>Score reCAPTCHA:</strong> ${escapeHtml(recaptchaResult.score)}</p>
                    `
                },
                toRecipients: [
                    {
                        emailAddress: {
                            address: 'sales@cscloudsolutions.com.ar'
                        }
                    }
                ]
            },
            saveToSentItems: "false"
        };

        // 4. Send Email via MS Graph
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
            console.error("[Demo Lead] Failed to send email", await sendResponse.text());
            throw new Error("Failed to send email via MS Graph");
        }

        console.log(`[Demo Lead] Email successfully sent for lead: ${companyName}`);
        return NextResponse.json({ success: true, message: "Lead captured successfully" });

    } catch (error) {
        console.error("[Demo Lead] Error processing lead", error);
        return NextResponse.json({ success: false, error: "Internal Server Error" }, { status: 500 });
    }
}
