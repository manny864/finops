# SAML SSO via WorkOS - Setup Guide

## Overview

This guide explains how to set up and use SAML Single Sign-On (SSO) for enterprise customers in the FinOps SaaS platform using WorkOS as the SAML broker.

## Requirements

- **Tier**: Enterprise tier only
- WorkOS account with API credentials (API key and Client ID)
- Customer's IdP (Okta, Auth0, AD FS, etc.)

## Setup Steps

### 1. WorkOS Account Setup

1. Create a WorkOS account at https://workos.com
2. From the WorkOS dashboard, obtain:
   - **API Key** (e.g., `sk_test_...`)
   - **Client ID** (e.g., `client_...`)
3. Store these in the environment variables

### 2. Environment Variables

Configure in `.env.development` or `.env.production`:

```env
# SSO via WorkOS
WORKOS_API_KEY=sk_test_your_api_key_here
WORKOS_CLIENT_ID=client_your_client_id_here
WORKOS_REDIRECT_URI=http://localhost:3000/api/auth/sso/callback
# For production: https://your-domain.com/api/auth/sso/callback

SSO_SESSION_SECRET=your-secret-min-32-characters-long-here
NEXT_PUBLIC_SSO_ENABLED=true
```

**IMPORTANT**: `SSO_SESSION_SECRET` must be at least 32 characters long. This secret is used to sign session JWT cookies.

### 3. Database Setup

When the app initializes, the following tables are automatically created:

- **TenantSSO**: Stores WorkOS organization and connection IDs per tenant
- **SSOSessions**: Stores active SAML sessions with expiration times

### 4. Customer-Side Configuration

For each enterprise customer that wants to enable SAML SSO:

1. **Navigate to Admin Panel**
   - Go to **Admin > SSO SAML** (only visible for Enterprise tier tenants)

2. **Gather WorkOS IDs**
   - Obtain the `workos_org_id` and `workos_connection_id` from your WorkOS dashboard
   - You may need to create a new Organization and Connection in WorkOS first

3. **Enter Configuration**
   - **Domain**: The customer's domain (e.g., `acme.com`)
   - **WorkOS Organization ID**: `org_...`
   - **WorkOS Connection ID**: `connection_...`
   - Toggle **Enable SSO**

4. **Generate Admin Portal Link**
   - Click **"Generar Admin Portal"** button
   - This generates a WorkOS portal link that opens in a new tab
   - Customer's IT admin receives an email with a setup link
   - They configure their IdP (Okta connection, Auth0, AD FS, etc.)

5. **Test SSO** (Optional)
   - Click **"Probar SSO"** to test the login flow
   - The browser will redirect to the IdP for authentication

### 5. How Users Log In

Once SAML is configured:

1. Users navigate to the login page
2. They select **"Login with SSO"** or use a domain-based redirect
3. They are redirected to `/api/auth/sso/start?domain=acme.com&tenantId=xxx`
4. WorkOS redirects them to their IdP (Okta, Auth0, etc.)
5. After authentication, WorkOS redirects to `/api/auth/sso/callback`
6. A session cookie is set (`finops_sso`)
7. User is logged in and redirected to the dashboard

### 6. Session Management

- **Session Duration**: 12 hours (configurable via `SESSION_TTL_HOURS` in `src/lib/ssoSession.ts`)
- **Cookie**: HttpOnly, Secure (in production), SameSite=Lax
- **Storage**: Sessions are stored in the `SSOSessions` table with expiration times
- **Logout**: POST to `/api/auth/sso/logout` to clear the session

## API Endpoints

### Authentication Flow

- **GET `/api/auth/sso/start?domain=acme.com&tenantId=xxx`** - Initiates SAML flow
- **GET `/api/auth/sso/callback?code=...&state=tenantId`** - WorkOS callback
- **POST `/api/auth/sso/logout`** - Clears SSO session
- **GET `/api/auth/sso/me`** - Returns current session info

### Admin API

- **GET `/api/admin/sso?tenantId=xxx`** - Retrieve SSO config (requires Admin/Owner role)
- **PUT `/api/admin/sso`** - Update SSO config (requires Admin/Owner role)
- **POST `/api/admin/sso/portal-link`** - Generate WorkOS admin portal link

## Coexistence with Azure AD MSAL

SSO is an **additional** login path. Existing Azure AD MSAL authentication is not modified:

- Users with Bearer JWT tokens from MSAL continue to work
- SSO session cookies coexist peacefully with MSAL tokens
- Both auth mechanisms can be used simultaneously
- The system respects whichever auth method the user has

## Troubleshooting

### "SSO not configured"
- Check that `WORKOS_API_KEY` and `WORKOS_CLIENT_ID` are set and don't contain "placeholder"
- Verify environment variables are loaded

### "SSO not enabled for this tenant"
- Navigate to Admin > SSO SAML
- Ensure the **Enable SSO** toggle is ON
- Save the configuration

### "Missing workos_connection_id"
- Generate a new admin portal link by clicking **"Generar Admin Portal"**
- Customer must configure their IdP through the WorkOS portal
- Once configured, the connection ID will be available in WorkOS dashboard

### Session expires quickly
- Verify `SSO_SESSION_SECRET` is set and at least 32 characters
- Check that DB session record hasn't been deleted
- Sessions expire after 12 hours by design

### User can't log in
- Test the flow manually: click **"Probar SSO"** from the Admin panel
- Verify the customer's IdP is configured correctly
- Check browser console for error messages
- Verify domain matches the one entered in the Admin panel

## Architecture Notes

### Security

1. **JWT Signing**: Session tokens are signed with HS256 using `SSO_SESSION_SECRET`
2. **HttpOnly Cookies**: Session cookies can't be accessed by JavaScript
3. **Session Storage**: Each session is recorded in the DB with expiration time
4. **RBAC**: Only tenant Admins/Owners can configure SSO
5. **Tier Gating**: SSO admin page only shows for Enterprise tier tenants

### Database

- **TenantSSO**: One record per tenant with WorkOS org/connection info
- **SSOSessions**: One record per active session (auto-expires in DB)
- Both tables include cascading deletes on tenant deletion

### Code Structure

- `src/lib/workosClient.ts` - WorkOS SDK initialization
- `src/lib/ssoSession.ts` - Session JWT signing and verification
- `src/app/api/auth/sso/*` - Authentication endpoints
- `src/app/api/admin/sso/*` - Admin configuration endpoints
- `src/app/[locale]/admin/sso/page.tsx` - Admin UI

## Testing

Run tests with:

```bash
npm run test -- __tests__/integration/api-sso.test.ts
```

Key test scenarios:
- SSO not configured returns 503
- Missing parameters return 400
- Invalid auth returns 401
- Successful flows redirect correctly

## Production Considerations

1. **Update WORKOS_REDIRECT_URI** to your production domain
2. **Change SSO_SESSION_SECRET** to a long, random string
3. **Ensure database backups** include the new SSO tables
4. **Monitor SSOSessions table** for expired sessions (they auto-expire)
5. **Test with a real IdP** (Okta trial account) before going live

## FAQ

**Q: Can I use SSO with Azure AD at the same time?**  
A: Yes. SSO is additional. Existing MSAL flows continue unchanged.

**Q: How many IdPs can one tenant use?**  
A: One connection per tenant (current design). Multiple connections would require schema changes.

**Q: What happens if SSO is disabled?**  
A: The admin page and SSO endpoints remain functional but will return 403 "SSO not enabled for this tenant".

**Q: How do I migrate users from MSAL to SSO?**  
A: Users can log in with either method. No migration needed—both are supported simultaneously.

**Q: Can admins see who logged in via SSO?**  
A: Session records are stored in SSOSessions but not exposed in the current UI. Could be added to an audit page.
