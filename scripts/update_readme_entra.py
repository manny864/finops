import os

def main():
    base_dir = "/Users/manuelchavez/Documents/FinOpsProyect"
    readme_path = os.path.join(base_dir, "README.md")
    
    addition = """
## Entra ID App Registration (Manual Setup)
To authenticate users across different organizations, you need to configure the identity provider to generate the clientId for the MSAL configuration. 

- **Create Registration:** Navigate to Microsoft Entra ID > App registrations > New registration.
- **Account Type:** Select *Accounts in any organizational directory (Any Microsoft Entra ID tenant - Multitenant)*. This is mandatory for the multi-tenant architecture.
- **Redirect URI:** Select *Single-page application (SPA)* from the platform dropdown and set the URL to `http://localhost:3000`.
- **API Permissions:** Add the required delegated permissions. For the core FinOps analysis, you need access to the Azure Service Management API (`user_impersonation`) and Microsoft Graph (`User.Read`).
- **Admin Consent:** Crucially, execute the admin consent flow to grant these permissions globally across your testing tenant.
"""
    
    with open(readme_path, "a") as f:
        f.write(addition)
        
    print("README.md actualizado exitosamente con la configuración de Entra ID.")

if __name__ == "__main__":
    main()
