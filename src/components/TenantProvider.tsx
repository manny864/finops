"use client";
import React, { createContext, useContext, useState, useEffect } from 'react';
import { useMsal } from '@azure/msal-react';

export interface Tenant {
  id: string;
  name: string;
  tier?: string;
  subscription_status?: string;
  trial_ends_at?: string;
  requires_rbac_update?: boolean;
}

interface TenantContextType {
  selectedTenant: Tenant;
  setSelectedTenant: (tenant: Tenant) => void;
  isAdmin: boolean;
  tenants: Tenant[];
  userRole: string;
  requiresRbacUpdate?: boolean;
}

const TenantContext = createContext<TenantContextType | undefined>(undefined);

export function TenantProvider({ children, demoSession }: { children: React.ReactNode, demoSession?: { isDemo: boolean; tier: string } | null }) {
  const { accounts } = useMsal();
  const [tenantsList, setTenantsList] = useState<Tenant[]>([{ id: 'default', name: 'Cargando entornos...' }]);
  const [selectedTenant, setSelectedTenant] = useState<Tenant>(() => {
    if (demoSession?.isDemo) {
      return { id: 'demo_tenant', name: 'Demo Workspace', tier: demoSession.tier };
    }
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('finops_active_tenant');
      if (saved) {
        try { return JSON.parse(saved); } catch(e) {}
      }
    }
    return { id: 'default', name: 'Cargando entornos...' };
  });

  // Sync to localStorage
  useEffect(() => {
    if (selectedTenant.id !== 'default') {
      localStorage.setItem('finops_active_tenant', JSON.stringify(selectedTenant));
    }
  }, [selectedTenant]);
  const [isAdmin, setIsAdmin] = useState(!!demoSession?.isDemo);
  const [userRole, setUserRole] = useState<string>(demoSession?.isDemo ? 'Admin' : 'Reader'); // Default to lowest privilege

  // Leer Base de Datos MySQL
  useEffect(() => {
    if (demoSession?.isDemo) return;
    fetch('/api/tenants')
      .then(res => res.json())
      .then(data => {
        if (data.tenants && data.tenants.length > 0) {
            setTenantsList(data.tenants);
            // Validate that current selection still exists in DB
            const savedId = selectedTenant.id;
            const stillExists = data.tenants.find((t: Tenant) => t.id === savedId);
            if (!stillExists || savedId === 'default') {
                // Saved tenant no longer in DB (was deleted), reset to first valid
                setSelectedTenant(data.tenants[0]);
                localStorage.removeItem('finops_active_tenant');
            } else if (stillExists && stillExists.name !== selectedTenant.name) {
                // Keep the selected tenant in sync with the DB name
                setSelectedTenant(stillExists);
            }
        }
      })
      .catch(err => console.error("Fallo al cargar tenants desde MySQL", err));
  }, []);

  useEffect(() => {
    if (demoSession?.isDemo) return;
    if (accounts.length > 0) {
      const username = accounts[0].username || "";
      const userTenant = accounts[0].tenantId;
      const isAdminUser = username.toLowerCase().endsWith("@cscloudsolutions.com.ar");
      setIsAdmin(isAdminUser);
      
      // Lógica de fallback robusta si no hay nada en localStorage
      if (selectedTenant.id === 'default') {
          if (!isAdminUser) {
              // Cliente normal: siempre usar su propio tenant (ignora si MySQL está atrasado)
              const myEnv = tenantsList.find(t => t.id === userTenant);
              setSelectedTenant(myEnv || { id: userTenant, name: "Mi Entorno (Azure)" });
          } else if (tenantsList.length > 1) {
              // Es Admin y hay tenants cargados: seleccionar el primero válido (no el default dummy)
              const firstValid = tenantsList.find(t => t.id !== 'default');
              if (firstValid) setSelectedTenant(firstValid);
          } else {
              // Es Admin pero MySQL falló o está vacío: fallback a su propio tenant
              setSelectedTenant({ id: userTenant, name: "Admin Workspace" });
          }
      }
    }
  }, [accounts, tenantsList]);

  const { instance } = useMsal();
  useEffect(() => {
      if (demoSession?.isDemo) return;
      // Fetch the role for the current tenant
      if (selectedTenant.id !== 'default' && accounts.length > 0) {
          const fetchRole = async () => {
              try {
                  const tokenResponse = await instance.acquireTokenSilent({
                      scopes: ["User.Read"],
                      account: accounts[0]
                  });
                  const res = await fetch(`/api/admin/config/users?tenantId=${selectedTenant.id}`, {
                      headers: { Authorization: `Bearer ${tokenResponse.idToken}` }
                  });
                  if (res.ok) {
                      const data = await res.json();
                      const myUser = data.users?.find((u: any) => u.entra_oid === (accounts[0].idTokenClaims as any)?.oid || u.entra_oid === accounts[0].localAccountId);
                      if (myUser && myUser.role) {
                          setUserRole(myUser.role);
                      } else {
                          // Si es el admin (owner) y no está en Users (o es SuperAdmin), dale Admin.
                          if (isAdmin || accounts[0].tenantId === selectedTenant.id) {
                              setUserRole('Admin');
                          } else {
                              setUserRole('Reader');
                          }
                      }
                  } else {
                      if (isAdmin || accounts[0].tenantId === selectedTenant.id) setUserRole('Admin');
                      else setUserRole('Reader');
                  }
              } catch(e) {
                  console.error("Error fetching role", e);
                  if (isAdmin || accounts[0].tenantId === selectedTenant.id) setUserRole('Admin');
              }
          };
          fetchRole();
      }
  }, [selectedTenant.id, accounts, instance, isAdmin]);

  const requiresRbacUpdate = selectedTenant?.requires_rbac_update;

  return (
    <TenantContext.Provider value={{ selectedTenant, setSelectedTenant, isAdmin, tenants: tenantsList, userRole, requiresRbacUpdate }}>
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
