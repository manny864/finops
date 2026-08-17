import os

base_dir = "/Users/manuelchavez/Documents/FinOpsProyect"

# 1. src/lib/tenants.ts
tenants_path = os.path.join(base_dir, "src", "lib", "tenants.ts")
tenants_content = """export interface Tenant {
  id: string;
  name: string;
}

export const tenants: Tenant[] = [
  {
    id: "54d7cf18-0baa-4da7-8242-fbf59a92aaac",
    name: "CSCloudSolutions Global"
  }
];
"""
with open(tenants_path, "w") as f:
    f.write(tenants_content)

# 2. src/components/TenantProvider.tsx
provider_path = os.path.join(base_dir, "src", "components", "TenantProvider.tsx")
provider_content = """"use client";
import React, { createContext, useContext, useState, useEffect } from 'react';
import { tenants, Tenant } from '@/lib/tenants';
import { useMsal } from '@azure/msal-react';

interface TenantContextType {
  selectedTenant: Tenant;
  setSelectedTenant: (tenant: Tenant) => void;
  isAdmin: boolean;
}

const TenantContext = createContext<TenantContextType | undefined>(undefined);

export function TenantProvider({ children }: { children: React.ReactNode }) {
  const { accounts } = useMsal();
  const [selectedTenant, setSelectedTenant] = useState<Tenant>(tenants[0]);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    if (accounts.length > 0) {
      const username = accounts[0].username || "";
      setIsAdmin(username.toLowerCase().endsWith("@cscloudsolutions.com.ar"));
    }
  }, [accounts]);

  return (
    <TenantContext.Provider value={{ selectedTenant, setSelectedTenant, isAdmin }}>
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
    f.write(provider_content)

# 3. Update ClientShell.tsx
shell_path = os.path.join(base_dir, "src", "components", "ClientShell.tsx")
with open(shell_path, "r") as f:
    shell_code = f.read()

# Import TenantProvider
shell_code = shell_code.replace(
    "import AuthProvider, { AuthButton } from \"./AuthProvider\";",
    "import AuthProvider, { AuthButton } from \"./AuthProvider\";\nimport { TenantProvider, useTenant } from './TenantProvider';\nimport { tenants } from '@/lib/tenants';"
)

# Wrap with TenantProvider
shell_code = shell_code.replace(
    "return <AuthProvider><ShellContent>{children}</ShellContent></AuthProvider>;",
    "return <AuthProvider><TenantProvider><ShellContent>{children}</ShellContent></TenantProvider></AuthProvider>;"
)

# Add useTenant hook
shell_code = shell_code.replace(
    "const [sidebarOpen, setSidebarOpen] = useState(true);",
    "const [sidebarOpen, setSidebarOpen] = useState(true);\n  const { selectedTenant, setSelectedTenant, isAdmin } = useTenant();"
)

# Replace Static dropdown with dynamic logic
old_dropdown = """            <div className="hidden md:flex items-center border border-gray-200 dark:border-gray-700 rounded-lg px-4 py-2 bg-gray-50/50 dark:bg-gray-800 relative group cursor-not-allowed">
              <div className="flex flex-col">
                 <span className="text-[10px] text-[#00AEEF] font-bold uppercase tracking-wider">Tenant (Admin Propietario)</span>
                 <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">CSCloudSolutions Global</span>
              </div>
              <svg className="w-4 h-4 ml-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
            </div>"""

new_dropdown = """            <div className="hidden md:flex items-center border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1 bg-gray-50/50 dark:bg-gray-800 relative">
              {isAdmin ? (
                <div className="flex flex-col px-2">
                  <label htmlFor="tenant-select" className="text-[10px] text-[#00AEEF] font-bold uppercase tracking-wider mb-1">
                    Tenant (Admin Propietario)
                  </label>
                  <select
                    id="tenant-select"
                    value={selectedTenant.id}
                    onChange={(e) => {
                      const found = tenants.find(t => t.id === e.target.value);
                      if (found) setSelectedTenant(found);
                    }}
                    className="text-sm font-semibold text-gray-700 dark:text-gray-300 bg-transparent border-none outline-none focus:ring-0 cursor-pointer p-0 m-0"
                  >
                    {tenants.map(t => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="flex flex-col px-2 cursor-not-allowed">
                  <span className="text-[10px] text-gray-500 font-bold uppercase tracking-wider">Mi Entorno (Cliente)</span>
                  <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">{selectedTenant.name}</span>
                </div>
              )}
            </div>"""

shell_code = shell_code.replace(old_dropdown, new_dropdown)

with open(shell_path, "w") as f:
    f.write(shell_code)

# 4. Update ZombieResourcesTable.tsx
table_path = os.path.join(base_dir, "src", "components", "ZombieResourcesTable.tsx")
with open(table_path, "r") as f:
    table_code = f.read()

# Add useTenant import
table_code = table_code.replace(
    "import { useMsal } from \"@azure/msal-react\";",
    "import { useMsal } from \"@azure/msal-react\";\nimport { useTenant } from './TenantProvider';"
)

# Get selectedTenant from hook
table_code = table_code.replace(
    "const { instance, accounts } = useMsal();",
    "const { instance, accounts } = useMsal();\n  const { selectedTenant } = useTenant();"
)

# Replace hardcoded tenantId
table_code = table_code.replace(
    "const tenantId = \"54d7cf18-0baa-4da7-8242-fbf59a92aaac\";",
    "const tenantId = selectedTenant.id;"
)

# Add selectedTenant to useEffect dependencies
table_code = table_code.replace(
    "}, [accounts, instance, selectedSub]);",
    "}, [accounts, instance, selectedSub, selectedTenant]);"
)

with open(table_path, "w") as f:
    f.write(table_code)

print("Arquitectura Multi-Tenant inyectada.")
