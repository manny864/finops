"use client";
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
  const [selectedTenant, setSelectedTenant] = useState<Tenant>(() => {
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
  const [isAdmin, setIsAdmin] = useState(false);

  // Leer Base de Datos MySQL
  useEffect(() => {
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
            }
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
