"use client";
import React, { createContext, useContext, useState, useEffect } from 'react';
import { useMsal } from '@azure/msal-react';
import { getMockDataForRoute } from '@/lib/mockData';
import { useRouter, usePathname } from 'next/navigation';

export interface Tenant {
  id: string;
  name: string;
  tier?: string;
  subscription_status?: string;
  trial_ends_at?: string;
  requires_rbac_update?: boolean;
  is_onboarded?: boolean;
}

interface TenantContextType {
  selectedTenant: Tenant;
  setSelectedTenant: (tenant: Tenant) => void;
  isAdmin: boolean;
  tenants: Tenant[];
  userRole: string;
  systemRole: string;
  userScope?: any;
  requiresRbacUpdate?: boolean;
}

const TenantContext = createContext<TenantContextType | undefined>(undefined);

export function TenantProvider({ children, demoSession }: { children: React.ReactNode, demoSession?: { isDemo: boolean; tier: string } | null }) {
  const router = useRouter();
  const pathname = usePathname();
  const { instance, accounts } = useMsal();
  const [tenantsList, setTenantsList] = useState<Tenant[]>([{ id: 'default', name: 'Cargando entornos...' }]);
  const selectedTenantRef = React.useRef<Tenant | null>(null);
  const [selectedTenant, setSelectedTenant] = useState<Tenant>(() => {
    if (demoSession?.isDemo) {
      let id = 'demo_tenant';
      let name = 'Demo Workspace';
      const tier = demoSession.tier?.toLowerCase() || 'essential';
      if (tier === 'essential') { id = '11111111-2222-3333-4444-555555555555'; name = 'Cliente ACME (Demo Essentials)'; }
      else if (tier === 'pro' || tier === 'professional') { id = '22222222-3333-4444-5555-666666666666'; name = 'Startup Tech (Demo Pro)'; }
      else if (tier === 'business') { id = '44444444-5555-6666-7777-888888888888'; name = 'Midmarket Corp (Demo Business)'; }
      else if (tier === 'enterprise') { id = '33333333-4444-5555-6666-777777777777'; name = 'Corporation XTZ (Demo Enterprise)'; }
      return { id, name, tier: demoSession.tier };
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
    selectedTenantRef.current = selectedTenant;
    if (selectedTenant.id !== 'default') {
      localStorage.setItem('finops_active_tenant', JSON.stringify(selectedTenant));
    }
  }, [selectedTenant]);
  const [isAdmin, setIsAdmin] = useState(!!demoSession?.isDemo);
  const [userRole, setUserRole] = useState<string>(demoSession?.isDemo ? 'Admin' : 'Reader'); // Default to lowest privilege
  const [systemRole, setSystemRole] = useState<string>('USER');
  const [userScope, setUserScope] = useState<any>(null);

  // Enforce Onboarding
  useEffect(() => {
    if (!demoSession?.isDemo && selectedTenant.id !== 'default' && typeof window !== 'undefined') {
        if ((selectedTenant.is_onboarded as any) === 0 || selectedTenant.is_onboarded === false) {
            if (!pathname?.includes('/admin/onboarding')) {
                // Keep the current locale
                const localeMatch = pathname?.match(/^\/([a-z]{2}(-[A-Z]{2})?)\//);
                const locale = localeMatch ? localeMatch[1] : 'en';
                router.push(`/${locale}/admin/onboarding`);
            }
        }
    }
  }, [selectedTenant, pathname, router, demoSession]);

  // Leer Base de Datos MySQL de forma segura con token
  useEffect(() => {
    if (demoSession?.isDemo) {
        setTenantsList([
            { id: '11111111-2222-3333-4444-555555555555', name: 'Cliente ACME (Demo Essentials)', tier: 'Essential' },
            { id: '22222222-3333-4444-5555-666666666666', name: 'Startup Tech (Demo Pro)', tier: 'Professional' },
            { id: '44444444-5555-6666-7777-888888888888', name: 'Midmarket Corp (Demo Business)', tier: 'Business' },
            { id: '33333333-4444-5555-6666-777777777777', name: 'Corporation XTZ (Demo Enterprise)', tier: 'Enterprise' }
        ]);
        return;
    }
    
    if (accounts.length > 0) {
        instance.acquireTokenSilent({
            scopes: ["User.Read"],
            account: accounts[0]
        }).then(tokenResponse => {
            return fetch('/api/tenants', {
                headers: { 'Authorization': `Bearer ${tokenResponse.idToken}` }
            });
        })
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
                } else if (stillExists && (stillExists.name !== selectedTenant.name || stillExists.tier !== selectedTenant.tier || stillExists.subscription_status !== selectedTenant.subscription_status)) {
                    // Keep the selected tenant in sync with the DB
                    setSelectedTenant(stillExists);
                }
            }
        })
        .catch(err => console.error("Fallo al cargar tenants desde MySQL", err));
    }
  }, [accounts, instance]);

  useEffect(() => {
    if (demoSession?.isDemo) return;
    if (accounts.length > 0) {
      const username = accounts[0].username || "";
      const userTenant = accounts[0].tenantId;
      const isAdminUser = username.toLowerCase().endsWith("@cscloudsolutions.com.ar") ;
      // Note: We don't setIsAdmin(isAdminUser) here anymore. We wait for system_role.
      
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

  // GLOBAL MOCK OVERRIDE FOR DEMO SESSIONS
  useEffect(() => {
      if (demoSession?.isDemo && typeof window !== 'undefined') {
          instance.acquireTokenSilent = async () => ({ idToken: 'demo', accessToken: 'demo' } as any);
          const originalFetch = window.fetch;
          window.fetch = async (input, init) => {
              const url = input.toString();
              const tier = selectedTenantRef.current?.tier?.toLowerCase() || demoSession.tier?.toLowerCase() || 'essential';
              if (url.includes('/api/intelligence/billing')) return new Response(JSON.stringify(getMockDataForRoute('billing', tier)), {status: 200});
              if (url.includes('/api/advisor')) return new Response(JSON.stringify(getMockDataForRoute('advisor', tier)), {status: 200});
              if (url.includes('/api/audit/full')) return new Response(JSON.stringify(getMockDataForRoute('audit_full', tier)), {status: 200});
              if (url.includes('/api/tags/compliance')) return new Response(JSON.stringify(getMockDataForRoute('tags_compliance', tier)), {status: 200});
              if (url.includes('/api/intelligence/network')) return new Response(JSON.stringify(getMockDataForRoute('network', tier)), {status: 200});
              if (url.includes('/api/intelligence/rates')) return new Response(JSON.stringify(getMockDataForRoute('rates', tier)), {status: 200});
              if (url.includes('/api/subscriptions')) return new Response(JSON.stringify({ subscriptions: [{id: 'mock-sub', name: 'Demo Subscription'}]}), {status: 200});
              if (url.includes('/api/intelligence/budgets')) return new Response(JSON.stringify(getMockDataForRoute('budgets', tier)), {status: 200});
              if (url.includes('/api/budgets/burn')) return new Response(JSON.stringify(getMockDataForRoute('budgets_burn', tier)), {status: 200});
              if (url.includes('/api/intelligence/history')) return new Response(JSON.stringify(getMockDataForRoute('history', tier)), {status: 200});
              if (url.includes('/api/intelligence/maturity')) return new Response(JSON.stringify(getMockDataForRoute('maturity', tier)), {status: 200});
              if (url.includes('/api/cleanup/zombies')) return new Response(JSON.stringify(getMockDataForRoute('audit_full', tier)), {status: 200});
              if (url.includes('/api/cleanup/ttl')) return new Response(JSON.stringify(getMockDataForRoute('ttl', tier)), {status: 200});
              if (url.includes('/api/power')) return new Response(JSON.stringify(getMockDataForRoute('schedules', tier)), {status: 200});
              if (url.includes('/api/intelligence/chargeback')) return new Response(JSON.stringify(getMockDataForRoute('chargeback', tier)), {status: 200});
              if (url.includes('/api/intelligence/licenses')) return new Response(JSON.stringify(getMockDataForRoute('licenses', tier)), {status: 200});
              if (url.includes('/api/intelligence/rightsizing')) return new Response(JSON.stringify(getMockDataForRoute('rightsizing', tier)), {status: 200});
              if (url.includes('/api/intelligence/anomalies')) return new Response(JSON.stringify(getMockDataForRoute('anomalies', tier)), {status: 200});
              if (url.includes('/api/admin/config/users')) return new Response(JSON.stringify(getMockDataForRoute('users', tier)), {status: 200});
              if (url.includes('/api/tags') && !url.includes('/api/tags/compliance')) return new Response(JSON.stringify(getMockDataForRoute('tags', tier)), {status: 200});
              return originalFetch(input, init);
          };
      }
  }, [demoSession, instance]);

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
                      if (data.isSuperAdmin) {
                          setIsAdmin(true);
                          setSystemRole('SUPERADMIN');
                      }
                      const myUser = data.users?.find((u: any) => u.entra_oid === (accounts[0].idTokenClaims as any)?.oid || u.entra_oid === accounts[0].localAccountId);
                      if (myUser) {
                          if (myUser.role) setUserRole(myUser.role);
                          if (myUser.scope) setUserScope(myUser.scope);
                          if (myUser.system_role && !data.isSuperAdmin) {
                              setSystemRole(myUser.system_role);
                          }
                      } else {
                          // Si es el admin (owner) y no está en Users (o es SuperAdmin), dale Admin.
                          if (data.isSuperAdmin || accounts[0].tenantId === selectedTenant.id || process.env.NODE_ENV === 'development') {
                              console.warn("[TenantProvider] Fallback: assigning Admin role (Owner, SuperAdmin, or Dev mode)");
                              setUserRole('Admin');
                          } else {
                              console.warn("[TenantProvider] Fallback: assigning Reader role");
                              setUserRole('Reader');
                          }
                      }
                  } else {
                      console.error("[TenantProvider] API Error fetching role. Status:", res.status);
                      if (isAdmin || accounts[0].tenantId === selectedTenant.id || process.env.NODE_ENV === 'development') {
                          console.warn("[TenantProvider] Fallback on API Error: assigning Admin role");
                          setUserRole('Admin');
                      }
                      else setUserRole('Reader');
                  }
              } catch(e) {
                  console.error("[TenantProvider] Error fetching role exception:", e);
                  if (isAdmin || accounts[0].tenantId === selectedTenant.id || process.env.NODE_ENV === 'development') {
                      console.warn("[TenantProvider] Fallback on Exception: assigning Admin role");
                      setUserRole('Admin');
                  }
              }
          };
          fetchRole();
      }
  }, [selectedTenant.id, accounts, instance, isAdmin]);

  const requiresRbacUpdate = selectedTenant?.requires_rbac_update;

  return (
    <TenantContext.Provider value={{ selectedTenant, setSelectedTenant, isAdmin, tenants: tenantsList, userRole, systemRole, userScope, requiresRbacUpdate }}>
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
