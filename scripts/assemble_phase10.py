import os

base_dir = "/Users/manuelchavez/Documents/FinOpsProyect"

def make_dirs(path):
    if not os.path.exists(path):
        os.makedirs(path)

make_dirs(os.path.join(base_dir, "src", "app", "api", "tenants"))

# 1. /api/tenants/route.ts
tenants_api = """import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

export async function GET(request: NextRequest) {
    try {
        const [rows] = await pool.query('SELECT tenant_id as id, company_name as name FROM Tenants ORDER BY created_at ASC');
        return NextResponse.json({ success: true, tenants: rows });
    } catch (error: any) {
        console.error('API GET /tenants error:', error);
        return NextResponse.json({ error: 'Fallo al leer la base de datos' }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { tenantId, name } = body;

        if (!tenantId) {
            return NextResponse.json({ error: 'Falta tenantId' }, { status: 400 });
        }

        // INSERT IGNORE ensures we don't duplicate clients that already logged in
        await pool.query(
            'INSERT IGNORE INTO Tenants (tenant_id, company_name) VALUES (?, ?)',
            [tenantId, name || 'Organización Desconocida']
        );

        return NextResponse.json({ success: true, message: 'Tenant sincronizado exitosamente.' });
    } catch (error: any) {
        console.error('API POST /tenants error:', error);
        return NextResponse.json({ error: 'Fallo al sincronizar Tenant' }, { status: 500 });
    }
}
"""
with open(os.path.join(base_dir, "src", "app", "api", "tenants", "route.ts"), "w") as f:
    f.write(tenants_api)

# 2. AuthSync.tsx
authsync_path = os.path.join(base_dir, "src", "components", "AuthSync.tsx")
authsync_code = """"use client";
import { useEffect } from 'react';
import { useMsal } from '@azure/msal-react';

export default function AuthSync() {
  const { accounts } = useMsal();

  useEffect(() => {
    if (accounts.length > 0) {
      const account = accounts[0];
      const tenantId = account.tenantId;
      const name = account.idTokenClaims?.name || account.name || "Entorno FinOps";

      // Registro silencioso en MySQL
      fetch('/api/tenants', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ tenantId, name })
      }).catch(err => console.error("Fallo la sincronización en background:", err));
    }
  }, [accounts]);

  return null;
}
"""
with open(authsync_path, "w") as f:
    f.write(authsync_code)

# 3. Modify TenantProvider.tsx
provider_path = os.path.join(base_dir, "src", "components", "TenantProvider.tsx")
provider_code = """"use client";
import React, { createContext, useContext, useState, useEffect } from 'react';
import { useMsal } from '@azure/msal-react';

export interface Tenant {
  id: string;
  name: string;
}

interface TenantContextType {
  selectedTenant: Tenant;
  setSelectedTenant: (tenant: Tenant) => void;
  isAdmin: boolean;
  tenants: Tenant[];
}

const TenantContext = createContext<TenantContextType | undefined>(undefined);

export function TenantProvider({ children }: { children: React.ReactNode }) {
  const { accounts } = useMsal();
  const [tenantsList, setTenantsList] = useState<Tenant[]>([{ id: 'default', name: 'Cargando entornos...' }]);
  const [selectedTenant, setSelectedTenant] = useState<Tenant>(tenantsList[0]);
  const [isAdmin, setIsAdmin] = useState(false);

  // Leer Base de Datos MySQL
  useEffect(() => {
    fetch('/api/tenants')
      .then(res => res.json())
      .then(data => {
        if (data.tenants && data.tenants.length > 0) {
            setTenantsList(data.tenants);
            // Seleccionar el primer tenant si está cargando
            setSelectedTenant(prev => prev.id === 'default' ? data.tenants[0] : prev);
        }
      })
      .catch(err => console.error("Fallo al cargar tenants desde MySQL", err));
  }, []);

  useEffect(() => {
    if (accounts.length > 0) {
      const username = accounts[0].username || "";
      const userTenant = accounts[0].tenantId;
      const isAdminUser = username.toLowerCase().endsWith("@cscloudsolutions.com.ar");
      setIsAdmin(isAdminUser);
      
      // Si no es admin, forzar su vista a su propio Tenant
      if (!isAdminUser && tenantsList.length > 0 && selectedTenant.id === 'default') {
          const myEnv = tenantsList.find(t => t.id === userTenant);
          if (myEnv) setSelectedTenant(myEnv);
      }
    }
  }, [accounts, tenantsList]);

  return (
    <TenantContext.Provider value={{ selectedTenant, setSelectedTenant, isAdmin, tenants: tenantsList }}>
      {children}
    </TenantContext.Provider>
  );
}

export function useTenant() {
  const context = useContext(TenantContext);
  if (context === undefined) {
    throw new Error('useTenant must be used within a TenantProvider');
  }
  return context;
}
"""
with open(provider_path, "w") as f:
    f.write(provider_code)

# 4. Modify ClientShell.tsx
shell_path = os.path.join(base_dir, "src", "components", "ClientShell.tsx")
with open(shell_path, "r") as f:
    shell_code = f.read()

# Add AuthSync import
if "import AuthSync" not in shell_code:
    shell_code = shell_code.replace(
        "import { TenantProvider, useTenant } from './TenantProvider';",
        "import { TenantProvider, useTenant } from './TenantProvider';\nimport AuthSync from './AuthSync';"
    )

# Remove static tenants import (we don't use it anymore)
shell_code = shell_code.replace("import { tenants } from '@/lib/tenants';\n", "")

# Add AuthSync inside AuthProvider
shell_code = shell_code.replace(
    "<AuthProvider><TenantProvider><ShellContent>",
    "<AuthProvider>\n      <AuthSync />\n      <TenantProvider>\n        <ShellContent>"
)
shell_code = shell_code.replace(
    "</ShellContent></TenantProvider></AuthProvider>",
    "</ShellContent>\n      </TenantProvider>\n    </AuthProvider>"
)

# Destructure tenants from useTenant()
shell_code = shell_code.replace(
    "const { selectedTenant, setSelectedTenant, isAdmin } = useTenant();",
    "const { selectedTenant, setSelectedTenant, isAdmin, tenants } = useTenant();"
)

with open(shell_path, "w") as f:
    f.write(shell_code)

# 5. Prevent ZombieResourcesTable from fetching if tenant is 'default'
table_path = os.path.join(base_dir, "src", "components", "ZombieResourcesTable.tsx")
with open(table_path, "r") as f:
    table_code = f.read()

table_code = table_code.replace(
    "if (accounts.length === 0) {",
    "if (accounts.length === 0 || selectedTenant.id === 'default') {"
)

with open(table_path, "w") as f:
    f.write(table_code)

print("Auto-registro de clientes y conexión MySQL completada exitosamente.")
