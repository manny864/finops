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
