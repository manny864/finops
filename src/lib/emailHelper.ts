/**
 * Helper for sending emails via Microsoft Graph
 * Fire-and-forget pattern - never blocks the main request
 */

export async function sendEmailAsync(
  subject: string,
  htmlContent: string,
  recipientEmail: string
): Promise<void> {
  try {
    const senderEmail = process.env.AZURE_SENDER_EMAIL;
    if (!senderEmail) {
      console.warn("[Email] AZURE_SENDER_EMAIL not configured. Skipping email.");
      return;
    }

    // Fire-and-forget: don't await this
    (async () => {
      try {
        const tokenResponse = await fetch(
          `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}/oauth2/v2.0/token`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              client_id: process.env.AZURE_CLIENT_ID || '',
              scope: 'https://graph.microsoft.com/.default',
              client_secret: process.env.AZURE_CLIENT_SECRET || '',
              grant_type: 'client_credentials',
            }),
          }
        );

        if (!tokenResponse.ok) {
          console.error("[Email] Failed to fetch MS Graph token:", await tokenResponse.text());
          return;
        }

        const tokenData = await tokenResponse.json() as any;
        const accessToken = tokenData.access_token;

        const mailPayload = {
          message: {
            subject,
            body: { contentType: 'HTML', content: htmlContent },
            toRecipients: [{ emailAddress: { address: recipientEmail } }],
          },
          saveToSentItems: 'false',
        };

        const sendResponse = await fetch(
          `https://graph.microsoft.com/v1.0/users/${senderEmail}/sendMail`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(mailPayload),
          }
        );

        if (!sendResponse.ok) {
          console.error("[Email] Failed to send email:", await sendResponse.text());
        } else {
          console.log(`[Email] Successfully sent "${subject}" to ${recipientEmail}`);
        }
      } catch (err) {
        console.error("[Email] Error sending email:", err);
      }
    })();
  } catch (err) {
    console.error("[Email] Error in sendEmailAsync:", err);
  }
}

export function getWelcomeEmailHtml(userEmail: string, companyName: string, planName: string): string {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://finops.example.com';
  
  return `
    <html>
      <head>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #0054A6 0%, #003d7a 100%); color: white; padding: 40px; text-align: center; border-radius: 8px 8px 0 0; }
          .content { background: white; border: 1px solid #e0e0e0; border-radius: 0 0 8px 8px; padding: 40px; }
          .button { display: inline-block; padding: 12px 32px; background-color: #0054A6; color: white; text-decoration: none; border-radius: 4px; font-weight: bold; margin-top: 20px; }
          .footer { text-align: center; font-size: 12px; color: #666; margin-top: 40px; padding-top: 20px; border-top: 1px solid #e0e0e0; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🎉 Welcome to FinOps SaaS!</h1>
          </div>
          <div class="content">
            <p>Hi there,</p>
            <p>Welcome to FinOps SaaS! Your 14-day free trial has started, and we're excited to help you optimize your Azure cloud costs.</p>
            
            <h2>Your Trial Includes:</h2>
            <ul>
              <li>✅ Full access to <strong>${planName}</strong> plan features</li>
              <li>✅ Real-time Azure cost analysis and recommendations</li>
              <li>✅ 14 days to explore all features at no cost</li>
              <li>✅ No credit card required</li>
            </ul>
            
            <h2>What's Next?</h2>
            <ol>
              <li>Connect your Azure subscription (if not already done)</li>
              <li>Explore your cost analytics dashboard</li>
              <li>Review FinOps recommendations tailored to your infrastructure</li>
            </ol>
            
            <p style="margin-top: 30px;">
              <a href="${baseUrl}/es" class="button">Go to Dashboard</a>
            </p>
            
            <p style="margin-top: 30px; color: #666; font-size: 14px;">
              If you have any questions or need help getting started, our support team is here to assist you at <strong>support@cscloudsolutions.com</strong>
            </p>
          </div>
          <div class="footer">
            <p>© 2026 CSCloudSolutions. All rights reserved.</p>
            <p>This is an automated email. Please do not reply to this message.</p>
          </div>
        </div>
      </body>
    </html>
  `;
}

export function getTrialReminderEmailHtml(daysLeft: number): string {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://finops.example.com';
  
  return `
    <html>
      <head>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); color: white; padding: 40px; text-align: center; border-radius: 8px 8px 0 0; }
          .content { background: white; border: 1px solid #e0e0e0; border-radius: 0 0 8px 8px; padding: 40px; }
          .button { display: inline-block; padding: 12px 32px; background-color: #f59e0b; color: white; text-decoration: none; border-radius: 4px; font-weight: bold; margin-top: 20px; }
          .footer { text-align: center; font-size: 12px; color: #666; margin-top: 40px; padding-top: 20px; border-top: 1px solid #e0e0e0; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>⏰ Your Trial is Ending Soon</h1>
          </div>
          <div class="content">
            <p>Hi there,</p>
            <p><strong>You have ${daysLeft} days left</strong> in your FinOps SaaS trial!</p>
            
            <p>Don't miss out on:</p>
            <ul>
              <li>💰 Continued cost optimization recommendations</li>
              <li>📊 Real-time Azure analytics</li>
              <li>🎯 Automated governance policies</li>
            </ul>
            
            <p style="margin-top: 30px;">
              <a href="${baseUrl}/pricing" class="button">Choose Your Plan</a>
            </p>
            
            <p style="margin-top: 30px; color: #666; font-size: 14px;">
              Have questions? Contact us at <strong>support@cscloudsolutions.com</strong>
            </p>
          </div>
          <div class="footer">
            <p>© 2026 CSCloudSolutions. All rights reserved.</p>
          </div>
        </div>
      </body>
    </html>
  `;
}

export function getTrialExpiredEmailHtml(): string {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://finops.example.com';
  
  return `
    <html>
      <head>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%); color: white; padding: 40px; text-align: center; border-radius: 8px 8px 0 0; }
          .content { background: white; border: 1px solid #e0e0e0; border-radius: 0 0 8px 8px; padding: 40px; }
          .button { display: inline-block; padding: 12px 32px; background-color: #ef4444; color: white; text-decoration: none; border-radius: 4px; font-weight: bold; margin-top: 20px; }
          .footer { text-align: center; font-size: 12px; color: #666; margin-top: 40px; padding-top: 20px; border-top: 1px solid #e0e0e0; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>📅 Your Trial Has Ended</h1>
          </div>
          <div class="content">
            <p>Hi there,</p>
            <p>Your 14-day free trial has ended. To continue using FinOps SaaS and keep your data, please upgrade to a paid plan.</p>
            
            <p style="margin-top: 30px;">
              <a href="${baseUrl}/pricing" class="button">Upgrade Now</a>
            </p>
            
            <p style="margin-top: 30px; color: #666; font-size: 14px;">
              Questions? Reach out to <strong>support@cscloudsolutions.com</strong> or contact our sales team at <strong>ventas@cscloudsolutions.com</strong>
            </p>
          </div>
          <div class="footer">
            <p>© 2026 CSCloudSolutions. All rights reserved.</p>
          </div>
        </div>
      </body>
    </html>
  `;
}
