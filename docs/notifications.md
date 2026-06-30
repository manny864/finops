# Multi-Channel Notifications

FinOps SaaS supports sending notifications across multiple channels: Slack, Microsoft Teams, and Email via SMTP.

## Overview

Each tenant can configure 0..N notification channels. When an alert is triggered, the system dispatches notifications to all enabled channels that match the severity filter.

### Supported Channels

1. **Slack** - Send via Slack Incoming Webhooks
2. **Microsoft Teams** - Send via Teams Incoming Webhooks
3. **Email** - Send via SMTP

## Configuration

### Slack

1. Go to your Slack workspace settings: `https://api.slack.com/apps`
2. Create a new app or select existing app → **Incoming Webhooks**
3. Click "Add New Webhook to Workspace"
4. Select a channel
5. Copy the webhook URL (starts with `https://hooks.slack.com/services/...`)
6. In FinOps SaaS Admin → **Notificaciones** → Add Channel → Select "Slack"
7. Paste the webhook URL and save

### Microsoft Teams

1. Go to your Teams channel → **⋯** (More options) → **Connectors**
2. Search for "Incoming Webhook"
3. Configure the webhook and give it a name
4. Copy the webhook URL
5. In FinOps SaaS Admin → **Notificaciones** → Add Channel → Select "Microsoft Teams"
6. Paste the webhook URL and save

### Email (SMTP)

Email notifications use SMTP. You can configure:

- **Global defaults** (environment variables):
  ```
  SMTP_HOST=smtp.gmail.com
  SMTP_PORT=587
  SMTP_SECURE=false
  SMTP_USER=your-email@gmail.com
  SMTP_PASSWORD=app-password
  SMTP_FROM="FinOps SaaS <noreply@finops.example.com>"
  ```

- **Per-channel overrides**: When creating an email channel, you can optionally override any SMTP settings. If not specified, global defaults are used.

## Severity Filtering

Each channel has a `severity_filter` that determines which alerts it receives:

- **info** - Informational messages
- **warning** - Warning-level alerts
- **error** - Error-level alerts

Example: `"warning,error"` means this channel only receives warnings and errors.

## API

### Create Channel

**POST** `/api/admin/notifications/channels?tenantId=<tenantId>`

Request body:
```json
{
  "type": "slack|teams|email",
  "name": "Channel name",
  "config_json": {
    // For slack/teams:
    "webhook_url": "https://hooks.slack.com/services/..."
    
    // For email:
    "recipients": ["user1@example.com", "user2@example.com"],
    "smtp_host": "smtp.gmail.com",  // optional, uses env default if omitted
    "smtp_port": 587,               // optional
    "smtp_secure": false,           // optional
    "smtp_user": "...",             // optional
    "smtp_password": "...",         // optional
    "smtp_from": "..."              // optional
  },
  "severity_filter": "info,warning,error"  // optional, default: all
}
```

### List Channels

**GET** `/api/admin/notifications/channels?tenantId=<tenantId>`

Response:
```json
{
  "success": true,
  "channels": [
    {
      "id": 1,
      "type": "slack",
      "name": "Platform Alerts",
      "severity_filter": "warning,error",
      "enabled": true,
      "created_at": "2024-01-15T10:30:00Z"
    }
  ]
}
```

### Update Channel

**PUT** `/api/admin/notifications/channels/<id>`

Request body:
```json
{
  "tenantId": "<tenantId>",
  "name": "New name",           // optional
  "severity_filter": "error",   // optional
  "enabled": false              // optional
}
```

### Delete Channel

**DELETE** `/api/admin/notifications/channels/<id>?tenantId=<tenantId>`

### Test Channel

**POST** `/api/admin/notifications/channels/<id>/test`

Request body:
```json
{
  "tenantId": "<tenantId>"
}
```

Sends a test notification through the specified channel.

## Programmatic Usage

### Send Notification

Use `notifyTenant()` from `src/lib/notifications.ts`:

```typescript
import { notifyTenant } from "@/lib/notifications";

const result = await notifyTenant("tenant123", {
  title: "Budget Alert",
  message: "Your monthly budget exceeded by 15%",
  severity: "warning",  // optional: 'info' | 'warning' | 'error', default: 'info'
  link: "https://app.finops.example.com/budgets",  // optional: CTA link
  metadata: { budgetId: "123", percentOver: 15 }    // optional: extra data
});

// Result structure:
// {
//   sent: 2,      // Number of successful sends
//   failed: 0,    // Number of failed sends
//   results: [    // Per-channel results
//     { channelId: 1, type: "slack", success: true },
//     { channelId: 2, type: "email", success: true }
//   ]
// }
```

### Legacy Backward Compatibility

The old `sendWebhookAlert()` function still works and is automatically dispatched through the new multi-channel system:

```typescript
import { sendWebhookAlert } from "@/lib/notifications";

// If no channels are configured and tenant has webhook_url set,
// this will still send to the webhook (backward compat)
await sendWebhookAlert("tenant123", "Alert Title", "Alert message", "warning");
```

## Database Schema

### NotificationChannels

Stores configured channels per tenant:

```sql
CREATE TABLE NotificationChannels (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id VARCHAR(255) NOT NULL,
  type ENUM('slack','teams','email') NOT NULL,
  name VARCHAR(255) NOT NULL,
  config_json JSON NOT NULL,
  severity_filter VARCHAR(50) DEFAULT 'info,warning,error',
  enabled BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_tenant (tenant_id),
  INDEX idx_tenant_type (tenant_id, type)
);
```

### NotificationLog

Logs all notification sends:

```sql
CREATE TABLE NotificationLog (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id VARCHAR(255) NOT NULL,
  channel_id INT,
  channel_type VARCHAR(50),
  title VARCHAR(500),
  message TEXT,
  severity VARCHAR(50),
  status ENUM('success','failed') NOT NULL,
  error_message TEXT,
  sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_tenant_date (tenant_id, sent_at)
);
```

## Features

- **Multi-tenant**: Each tenant has independent channel configuration
- **Severity filtering**: Channels can filter by severity level
- **Per-channel overrides**: Email channels can override SMTP settings
- **Test endpoint**: Verify channel configuration before relying on it
- **Audit logging**: All sends are logged with success/failure status
- **Backward compatible**: Old `sendWebhookAlert()` calls still work
- **Error handling**: Failed sends don't abort other channels (Promise.allSettled)

## Troubleshooting

### Email not sending

1. Verify `SMTP_HOST` is set (not "smtp.example.com")
2. Check `SMTP_USER` and `SMTP_PASSWORD` are correct
3. For Gmail, use App Password (not regular password)
4. Check firewall/network allows SMTP port (usually 587)
5. Review NotificationLog table for error messages

### Slack/Teams webhook not working

1. Test the webhook URL directly with curl:
   ```bash
   curl -X POST https://hooks.slack.com/services/... \
     -H 'Content-Type: application/json' \
     -d '{"text":"test"}'
   ```
2. Verify webhook URL is correct and not expired
3. Check channel is still enabled in Slack/Teams settings

### No notifications received

1. Check channel is `enabled = true`
2. Check `severity_filter` matches the alert level
3. Test channel from FinOps SaaS Admin UI
4. Review NotificationLog for failures
5. Verify tenant has at least one channel configured

## Tier Availability

- **Professional**: 2+ channels
- **Enterprise**: Unlimited channels + per-channel SMTP overrides
