import os
import subprocess

def main():
    base_dir = "/Users/manuelchavez/Documents/FinOpsProyect"
    print("Iniciando inyección de Persistencia y Onboarding (Fase 3)...")
    
    # 1. Instalar librerías MSAL
    print("Instalando @azure/msal-browser y @azure/msal-react...")
    subprocess.run(["npm", "install", "@azure/msal-browser", "@azure/msal-react"], cwd=base_dir, check=True)

    # 2. Crear schema.sql
    db_dir = os.path.join(base_dir, "src", "db")
    os.makedirs(db_dir, exist_ok=True)
    schema_path = os.path.join(db_dir, "schema.sql")
    schema_code = """
CREATE TABLE IF NOT EXISTS Tenants (
    id INT AUTO_INCREMENT PRIMARY KEY,
    tenant_id VARCHAR(255) UNIQUE NOT NULL,
    company_name VARCHAR(255),
    status VARCHAR(50) DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS Users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    entra_oid VARCHAR(255) UNIQUE NOT NULL,
    tenant_id VARCHAR(255) NOT NULL,
    email VARCHAR(255),
    role VARCHAR(50) DEFAULT 'admin',
    FOREIGN KEY (tenant_id) REFERENCES Tenants(tenant_id) ON DELETE CASCADE
);
"""
    with open(schema_path, "w") as f:
        f.write(schema_code)

    # 3. Refactorizar db.ts para incluir inicializador
    db_ts_path = os.path.join(base_dir, "src", "lib", "db.ts")
    db_ts_code = """import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';

const pool = mysql.createPool(process.env.DATABASE_URL || 'mysql://finops_user:finopspassword@localhost:3306/finops_app');

let dbInitialized = false;

export async function initializeDatabase() {
    if (dbInitialized) return;
    try {
        const schemaPath = path.join(process.cwd(), 'src', 'db', 'schema.sql');
        const schema = fs.readFileSync(schemaPath, 'utf8');
        const queries = schema.split(';').filter(q => q.trim().length > 0);
        
        const connection = await pool.getConnection();
        for (const query of queries) {
            await connection.query(query);
        }
        connection.release();
        dbInitialized = true;
        console.log("Database schema validated/initialized successfully.");
    } catch (error) {
        console.error("Failed to initialize database schema:", error);
    }
}

export default pool;
"""
    with open(db_ts_path, "w") as f:
        f.write(db_ts_code)

    # 4. Crear API de Onboarding
    api_dir = os.path.join(base_dir, "src", "app", "api", "onboard")
    os.makedirs(api_dir, exist_ok=True)
    onboard_path = os.path.join(api_dir, "route.ts")
    onboard_code = """import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import pool, { initializeDatabase } from "@/lib/db";

export async function POST(request: NextRequest) {
    try {
        // Garantizamos que las tablas existan
        await initializeDatabase();

        const authHeader = request.headers.get("authorization");
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return NextResponse.json({ error: "Falta token Bearer de autenticación." }, { status: 401 });
        }

        const token = authHeader.split(" ")[1];
        const decoded = jwt.decode(token) as any;

        if (!decoded || !decoded.tid || !decoded.oid) {
            return NextResponse.json({ error: "Token inválido o incompleto." }, { status: 400 });
        }

        const tenantId = decoded.tid;
        const entraOid = decoded.oid;
        const companyName = decoded.name || "Default Company";
        const email = decoded.preferred_username || decoded.email || "Unknown";

        const connection = await pool.getConnection();
        
        try {
            await connection.beginTransaction();

            // UPSERT Tenant (Insert or Update)
            const insertTenantQuery = `
                INSERT INTO Tenants (tenant_id, company_name) 
                VALUES (?, ?) 
                ON DUPLICATE KEY UPDATE company_name = VALUES(company_name)
            `;
            await connection.query(insertTenantQuery, [tenantId, companyName]);

            // UPSERT User
            const insertUserQuery = `
                INSERT INTO Users (entra_oid, tenant_id, email) 
                VALUES (?, ?, ?) 
                ON DUPLICATE KEY UPDATE email = VALUES(email)
            `;
            await connection.query(insertUserQuery, [entraOid, tenantId, email]);

            await connection.commit();
        } catch (dbError) {
            await connection.rollback();
            throw dbError;
        } finally {
            connection.release();
        }

        return NextResponse.json({ success: true, message: "Onboarding completado exitosamente en base de datos." });

    } catch (error: any) {
        console.error("Onboard API Error:", error);
        return NextResponse.json({ error: "Error interno del servidor", details: error.message }, { status: 500 });
    }
}
"""
    with open(onboard_path, "w") as f:
        f.write(onboard_code)

    # 5. Crear componente AuthProvider.tsx
    auth_path = os.path.join(base_dir, "src", "components", "AuthProvider.tsx")
    auth_code = """"use client";
import React, { ReactNode, useEffect, useState } from "react";
import { PublicClientApplication } from "@azure/msal-browser";
import { MsalProvider, useMsal } from "@azure/msal-react";

// Instanciación asíncrona robusta para MSAL v3+
const pca = new PublicClientApplication({
    auth: {
        clientId: process.env.NEXT_PUBLIC_CLIENT_ID || "not-configured",
        authority: "https://login.microsoftonline.com/common",
        redirectUri: typeof window !== "undefined" ? window.location.origin : "/",
    }
});

export function AuthButton() {
    const { instance, accounts, inProgress } = useMsal();

    const handleLogin = async () => {
        try {
            const loginResponse = await instance.loginPopup({
                scopes: ["User.Read", "Directory.Read.All"]
            });

            if (loginResponse && loginResponse.accessToken) {
                console.log("Token adquirido. Registrando Tenant en BD local...");
                const response = await fetch('/api/onboard', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${loginResponse.accessToken}` }
                });

                const data = await response.json();
                if (response.ok) {
                    alert("¡Onboarding exitoso! El Tenant y el Usuario han sido registrados en MySQL.");
                } else {
                    alert(`Error en el Onboarding: ${data.error}`);
                }
            }
        } catch (e) {
            console.error("Fallo de autenticación MSAL:", e);
        }
    };

    if (accounts.length > 0) {
        return <span className="text-white text-sm mr-4">Hola, {accounts[0].name}</span>;
    }

    if (inProgress === "startup") {
        return <span className="text-gray-300 text-sm">Cargando auth...</span>;
    }

    return (
        <button 
            onClick={handleLogin}
            className="bg-amber-500 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-amber-600 transition-colors shadow-sm ml-2"
        >
            Login & Onboard
        </button>
    );
}

export default function AuthProvider({ children }: { children: ReactNode }) {
    const [msalInitialized, setMsalInitialized] = useState(false);

    useEffect(() => {
        pca.initialize().then(() => {
            setMsalInitialized(true);
        }).catch(e => {
            console.error("Error inicializando MSAL:", e);
        });
    }, []);

    if (!msalInitialized) {
        return <>{children}</>;
    }

    return (
        <MsalProvider instance={pca}>
            {children}
        </MsalProvider>
    );
}
"""
    with open(auth_path, "w") as f:
        f.write(auth_code)

    # 6. Reemplazar botón en ClientShell.tsx
    shell_path = os.path.join(base_dir, "src", "components", "ClientShell.tsx")
    with open(shell_path, "r") as f:
        shell_content = f.read()
    
    # Inyectar wrapper AuthProvider y AuthButton
    if "AuthProvider" not in shell_content:
        shell_content = shell_content.replace('import AdminConsentButton from "./AdminConsentButton";', 'import AuthProvider, { AuthButton } from "./AuthProvider";')
        shell_content = shell_content.replace('<AdminConsentButton />', '<AuthButton />')
        shell_content = shell_content.replace('export default function ClientShell({ children }: { children: React.ReactNode }) {', 'export default function ClientShell({ children }: { children: React.ReactNode }) {\n  return <AuthProvider><ShellContent>{children}</ShellContent></AuthProvider>;\n}\n\nfunction ShellContent({ children }: { children: React.ReactNode }) {')
        with open(shell_path, "w") as f:
            f.write(shell_content)

    print("Inyección Fase 3 completada.")

if __name__ == "__main__":
    main()
