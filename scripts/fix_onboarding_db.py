import os

def main():
    base_dir = "/Users/manuelchavez/Documents/FinOpsProyect"
    
    # 1. Update /api/onboard/route.ts
    onboard_route = os.path.join(base_dir, "src/app/api/onboard/route.ts")
    with open(onboard_route, "r") as f:
        content = f.read()
    
    # Replace VALUES(company_name) with parameter binding
    content = content.replace(
        "ON DUPLICATE KEY UPDATE company_name = VALUES(company_name)",
        "ON DUPLICATE KEY UPDATE company_name = ?"
    )
    content = content.replace(
        "await connection.query(insertTenantQuery, [tenantId, companyName]);",
        "await connection.query(insertTenantQuery, [tenantId, companyName, companyName]);"
    )
    
    # Replace VALUES(email) with parameter binding
    content = content.replace(
        "ON DUPLICATE KEY UPDATE email = VALUES(email)",
        "ON DUPLICATE KEY UPDATE email = ?"
    )
    content = content.replace(
        "await connection.query(insertUserQuery, [entraOid, tenantId, email]);",
        "await connection.query(insertUserQuery, [entraOid, tenantId, email, email]);"
    )
    
    with open(onboard_route, "w") as f:
        f.write(content)

    # 2. Update AuthProvider.tsx to log details
    auth_provider = os.path.join(base_dir, "src/components/AuthProvider.tsx")
    with open(auth_provider, "r") as f:
        auth_content = f.read()

    auth_content = auth_content.replace(
        'console.error("Fallo Onboarding DB:", data.error);',
        'console.error("Fallo Onboarding DB:", data.error, data.details);'
    )
    with open(auth_provider, "w") as f:
        f.write(auth_content)

    print("Ejecución del parche de Onboarding completada.")

if __name__ == "__main__":
    main()
