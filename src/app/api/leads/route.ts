import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { fullName, email, company, spend, requirements } = body;

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

        // 2. Construct Email Payload
        const mailPayload = {
            message: {
                subject: `🚨 NUEVO LEAD ENTERPRISE - FinOps: ${company}`,
                body: {
                    contentType: "HTML",
                    content: `
                        <h2>Nuevo Lead Enterprise Capturado</h2>
                        <p><strong>Nombre:</strong> ${fullName}</p>
                        <p><strong>Email:</strong> ${email}</p>
                        <p><strong>Empresa:</strong> <span style="font-size: 1.2em; color: #0054A6;">${company}</span></p>
                        <p><strong>Gasto Mensual Cloud:</strong> <strong style="font-size: 1.1em; color: #D32F2F;">${spend}</strong></p>
                        <p><strong>Requerimientos:</strong><br/>${requirements || "N/A"}</p>
                    `
                },
                toRecipients: [
                    {
                        emailAddress: {
                            address: process.env.AZURE_RECIPIENT_EMAIL || process.env.CONTACT_EMAIL_RECIPIENT || 'ventas@cscloudsolutions.com'
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
