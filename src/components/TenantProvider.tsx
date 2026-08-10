"use client";
import React, { createContext, useContext, useState, useEffect } from 'react';
import { useMsal } from '@azure/msal-react';
import { getMockDataForRoute, getMockCostGroupDetail, getMockNetworkServiceCostV2, isMockTenant } from '@/lib/mockData';
import { usePathname, useRouter } from 'next/navigation';
import { getFreshIdToken } from '@/lib/msalToken';
import { parsePermissions, type RoleTag } from '@/lib/pageRoleTags';

export interface Tenant {
  id: string;
  name: string;
  tier?: string;
  subscription_status?: string;
  trial_ends_at?: string;
  access_until?: string;
  has_logo?: boolean;
  logo_version?: string | null;
  requires_rbac_update?: boolean;
  is_onboarded?: boolean;
  client_id?: string | null;
  has_client_secret?: boolean;
  partner_link_status?: string | null;
  partner_link_detail?: string | null;
  /** Proveedor de nube del tenant (ver src/lib/providerPolicy.ts). */
  provider?: 'azure';
  /** Zona horaria IANA del tenant (ver src/lib/timezone.ts). Gobierna cómo se
   *  muestran las fechas y el default de los horarios de Power Schedules. */
  timezone?: string;
}

interface TenantContextType {
  selectedTenant: Tenant;
  setSelectedTenant: (tenant: Tenant) => void;
  isAdmin: boolean;
  tenants: Tenant[];
  userRole: string;
  // Permisos de dominio (FinOps/CloudAdmin/Security/ProductOwner), ortogonales
  // a userRole — ver src/lib/pageRoleTags.ts. Admin/Owner/SuperAdmin ven todo
  // sin necesidad de permisos asignados (ver Sidebar.tsx).
  userPermissions: RoleTag[];
  systemRole: string;
  userScope?: any;
  requiresRbacUpdate?: boolean;
  // Certificación de Academia FinOps del USUARIO actual (no del tenant — cada
  // usuario nuevo de la organización debe completarla, sin importar si otros
  // ya lo hicieron). null = todavía no se resolvió.
  academyCertified: boolean | null;
  setAcademyCertified: (certified: boolean) => void;
}

const TenantContext = createContext<TenantContextType | undefined>(undefined);

export function TenantProvider({ children, demoSession }: { children: React.ReactNode, demoSession?: { isDemo: boolean; tier: string; provider?: string } | null }) {
  const router = useRouter();
  const pathname = usePathname();
  const { instance, accounts, inProgress } = useMsal();
  const [tenantsList, setTenantsList] = useState<Tenant[]>([{ id: 'default', name: 'Cargando entornos...' }]);
  const [selectedTenant, setSelectedTenant] = useState<Tenant>(() => {
    if (demoSession?.isDemo) {
      let id = 'demo_tenant';
      let name = 'Demo Workspace';
      const tier = demoSession.tier?.toLowerCase() || 'essential';
      if (tier === 'essential') { id = '11111111-2222-3333-4444-555555555555'; name = 'Cliente ACME (Demo Essentials)'; }
      else if (tier === 'pro' || tier === 'professional') { id = '22222222-3333-4444-5555-666666666666'; name = 'Startup Tech (Demo Pro)'; }
      else if (tier === 'business') { id = '44444444-5555-6666-7777-888888888888'; name = 'Midmarket Corp (Demo Business)'; }
      else if (tier === 'enterprise') { id = '33333333-4444-5555-6666-777777777777'; name = 'Corporation XTZ (Demo Enterprise)'; }
      return { id, name, tier: demoSession.tier, provider: 'azure' };
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
  const [userPermissions, setUserPermissions] = useState<RoleTag[]>([]);
  const [systemRole, setSystemRole] = useState<string>('USER');
  const [authzResolved, setAuthzResolved] = useState<boolean>(!!demoSession?.isDemo);
  const [userScope, setUserScope] = useState<any>(null);

  // Estado de certificación de Academia FinOps del USUARIO actual. Deliberadamente
  // independiente de `selectedTenant.is_onboarded` (que es una columna a nivel
  // Tenant, compartida por toda la organización) — si se usara esa columna,
  // que un solo usuario complete la Academia (o el onboarding técnico de Azure,
  // que también la toca) marcaría a TODOS los usuarios del tenant como
  // certificados. Se resuelve consultando el progreso propio vía
  // /api/academy/content, que ya está scopeado por usuario en el backend.
  const [academyCertified, setAcademyCertified] = useState<boolean | null>(null);

  useEffect(() => {
    if (!authzResolved) return;
    if (systemRole === 'SUPERADMIN') {
        setAcademyCertified(null);
        return;
    }
    if (demoSession?.isDemo || selectedTenant.id === 'default' || isMockTenant(selectedTenant.id)) {
        setAcademyCertified(null);
        return;
    }
    if (accounts.length === 0) return;
    let cancelled = false;
    (async () => {
        try {
            const idToken = await getFreshIdToken(instance, accounts[0]);
            const res = await fetch(`/api/academy/content?tenantId=${selectedTenant.id}`, {
                headers: { Authorization: `Bearer ${idToken}` }
            });
            if (!res.ok) return;
            const data = await res.json();
            if (!cancelled) setAcademyCertified(!!data.isCertified);
        } catch (e) {
            console.error('[TenantProvider] Failed to check Academy status:', e);
        }
    })();
    return () => { cancelled = true; };
  }, [selectedTenant.id, accounts.length, instance, demoSession, authzResolved, systemRole]);

  // Enforce Academy completion: debe ser la primera página que ve un usuario
  // nuevo de la organización — si no la completó, no puede acceder al resto
  // de features. SUPERADMIN nunca es forzado (no es parte de la ruta de
  // aprendizaje del cliente).
  useEffect(() => {
    if (selectedTenant.id !== 'default' && typeof window !== 'undefined') {
        // Skip redirect for demo/mock tenants
        if (isMockTenant(selectedTenant.id) || demoSession?.isDemo) return;
        if (!authzResolved) return;
        if (systemRole === 'SUPERADMIN') return;

        if (academyCertified === false) {
            if (!pathname?.includes('/academy')) {
                // Keep the current locale
                const localeMatch = pathname?.match(/^\/([a-z]{2}(-[A-Z]{2})?)\//);
                const locale = localeMatch ? localeMatch[1] : 'en';
                router.push(`/${locale}/academy`);
            }
        }
    }
  }, [selectedTenant, pathname, router, demoSession, academyCertified, systemRole, authzResolved]);

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
        const fetchTenants = async () => {
            // getFreshIdToken decodes JWT exp and forces refresh if <5min remaining,
            // avoiding "Token expirado" 401 with stale cached idTokens.
            let idToken = await getFreshIdToken(instance, accounts[0], ['User.Read']);
            let res = await fetch('/api/tenants', { headers: { 'Authorization': `Bearer ${idToken}` } });
            if (res.status === 401) {
                // Last-resort retry with hard refresh
                const fresh = await instance.acquireTokenSilent({ scopes: ['User.Read'], account: accounts[0], forceRefresh: true });
                idToken = fresh.idToken;
                res = await fetch('/api/tenants', { headers: { 'Authorization': `Bearer ${idToken}` } });
            }
            return res.json();
        };
        fetchTenants()
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
                } else if (stillExists && (stillExists.name !== selectedTenant.name || stillExists.tier !== selectedTenant.tier || stillExists.subscription_status !== selectedTenant.subscription_status || !!stillExists.is_onboarded !== !!selectedTenant.is_onboarded)) {
                    // Keep the selected tenant in sync with the DB
                    setSelectedTenant(stillExists);
                }
            } else if (accounts[0]?.tenantId) {
                const fallbackTenant = { id: accounts[0].tenantId, name: "Mi Entorno (Azure)" };
                setTenantsList([fallbackTenant]);
                if (selectedTenant.id === 'default') {
                    setSelectedTenant(fallbackTenant);
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

  // GLOBAL MOCK OVERRIDE FOR DEMO SESSIONS or when a MOCK TENANT is selected
  function applyDemoFetchInterception() {
      const tenantIsMock = isMockTenant(selectedTenant?.id || '');
      const shouldIntercept = demoSession?.isDemo || tenantIsMock;
      if (shouldIntercept && typeof window !== 'undefined') {
          if (!(instance as any).__finopsOriginalAcquire) {
              (instance as any).__finopsOriginalAcquire = instance.acquireTokenSilent.bind(instance);
          }
          instance.acquireTokenSilent = async (req: any) => {
              // For User.Read (used by /api/tenants and other real endpoints we don't
              // intercept), ALWAYS use the real Entra token. Don't swallow errors —
              // a real failure must propagate so the caller doesn't send a fake token
              // to a real endpoint and get 401.
              if (req?.scopes?.includes('User.Read') && (instance as any).__finopsOriginalAcquire) {
                  return await (instance as any).__finopsOriginalAcquire(req);
              }
              return ({ idToken: 'demo', accessToken: 'demo' } as any);
          };
          const originalFetch = (window as any).__finopsOriginalFetch || window.fetch;
          (window as any).__finopsOriginalFetch = originalFetch;
          window.fetch = async (input, init) => {
              const url = input.toString();
              // Never intercept the tenant list (selector needs real DB data)
              if (url.includes('/api/tenants') && !url.match(/\/api\/tenants\/[a-f0-9-]+\//i)) {
                  return originalFetch(input, init);
              }
              const tier = selectedTenant?.tier?.toLowerCase() || demoSession?.tier?.toLowerCase() || 'essential';
              const mockKey = tier;
              if (url.includes('/api/intelligence/billing')) return new Response(JSON.stringify(getMockDataForRoute('billing', mockKey)), {status: 200});
              if (url.includes('/api/advisor')) {
                  const advLocale = (url.match(/[?&]locale=([^&]+)/)?.[1] && decodeURIComponent(url.match(/[?&]locale=([^&]+)/)![1])) || 'es';
                  return new Response(JSON.stringify(getMockDataForRoute('advisor', mockKey, advLocale)), {status: 200});
              }
              if (url.includes('/api/academy/content')) {
                  if (init?.method === 'POST') return new Response(JSON.stringify({ success: true, mock: true }), {status: 200});
                  return new Response(JSON.stringify(getMockDataForRoute('academy', mockKey)), {status: 200});
              }
              if (url.includes('/api/audit/full')) return new Response(JSON.stringify(getMockDataForRoute('audit_full', mockKey)), {status: 200});
              if (url.includes('/api/audit/ttl')) return new Response(JSON.stringify(getMockDataForRoute('ttl', mockKey)), {status: 200});
              if (url.includes('/api/tags/compliance')) return new Response(JSON.stringify(getMockDataForRoute('tags_compliance', mockKey)), {status: 200});
              if (url.includes('/api/intelligence/network/service-cost-v2')) {
                  const parsed = new URL(url, window.location.origin);
                  const family = (parsed.searchParams.get('family') || 'analysis') as "analysis" | "basic" | "hybrid" | "balancing" | "internet";
                  return new Response(JSON.stringify(getMockNetworkServiceCostV2(mockKey, family)), {status: 200});
              }
              if (url.includes('/api/intelligence/network')) return new Response(JSON.stringify(getMockDataForRoute('network', mockKey)), {status: 200});
              if (url.includes('/api/intelligence/rates')) return new Response(JSON.stringify(getMockDataForRoute('rates', mockKey)), {status: 200});
              if (url.includes('/api/subscriptions')) return new Response(JSON.stringify({ subscriptions: [{id: 'mock-sub', name: 'Demo Subscription'}]}), {status: 200});
              if (url.includes('/api/intelligence/budgets')) return new Response(JSON.stringify(getMockDataForRoute('budgets', mockKey)), {status: 200});
              if (url.includes('/api/budgets/burn')) return new Response(JSON.stringify(getMockDataForRoute('budgets_burn', mockKey)), {status: 200});
              if (url.includes('/api/budgets/alerts')) return new Response(JSON.stringify(getMockDataForRoute('alerts', mockKey)), {status: 200});
              if (url.includes('/api/intelligence/history')) return new Response(JSON.stringify(getMockDataForRoute('history', mockKey)), {status: 200});
              if (url.includes('/api/intelligence/forecast')) return new Response(JSON.stringify(getMockDataForRoute('forecast', mockKey)), {status: 200});
              if (url.includes('/api/intelligence/maturity')) return new Response(JSON.stringify(getMockDataForRoute('maturity', mockKey)), {status: 200});
              if (url.includes('/api/cleanup/zombies/networking')) return new Response(JSON.stringify(getMockDataForRoute('networking_zombies', mockKey)), {status: 200});
              if (url.includes('/api/cleanup/zombies')) return new Response(JSON.stringify(getMockDataForRoute('audit_full', mockKey)), {status: 200});
              if (url.includes('/api/cleanup/ttl/policies')) {
                  const method = (init?.method || 'GET').toUpperCase();
                  if (method === 'GET') return new Response(JSON.stringify(getMockDataForRoute('ttl_policies', mockKey)), {status: 200});
                  if (method === 'POST') return new Response(JSON.stringify({ success: true, mock: true }), {status: 201});
                  if (method === 'DELETE') return new Response(JSON.stringify({ success: true, mock: true }), {status: 200});
              }
              if (url.includes('/api/cleanup/ttl/unlabeled')) return new Response(JSON.stringify(getMockDataForRoute('ttl_unlabeled', mockKey)), {status: 200});
              if (url.includes('/api/cleanup/ttl/history')) return new Response(JSON.stringify(getMockDataForRoute('ttl_history', mockKey)), {status: 200});
              if (url.includes('/api/tags/apply')) return new Response(JSON.stringify({ success: true, mock: true }), {status: 200});
              if (url.includes('/api/cleanup/ttl')) {
                  const m = (selectedTenant?.tier?.toLowerCase()==='enterprise')?50:(selectedTenant?.tier?.toLowerCase()==='business')?10:(selectedTenant?.tier?.toLowerCase()==='pro')?3:1;
                  const now = Date.now();
                  const day = 86400000;
                  const baseResources = [
                      { name: 'sandbox-poc-payments', type: 'microsoft.resources/subscriptions/resourcegroups', resourceGroup: 'sandbox-poc-payments', location: 'eastus', owner: 'jdoe@contoso.com', daysOverdue: 18, expirationDate: new Date(now - 18*day).toISOString() },
                      { name: 'dev-vm-loadtest-01', type: 'microsoft.compute/virtualmachines', resourceGroup: 'qa-loadtest-rg', location: 'westeurope', owner: 'qa-team@contoso.com', daysOverdue: 9, expirationDate: new Date(now - 9*day).toISOString() },
                      { name: 'tmp-aks-experiment', type: 'microsoft.containerservice/managedclusters', resourceGroup: 'aks-lab-rg', location: 'centralus', owner: 'devops@contoso.com', daysOverdue: 31, expirationDate: new Date(now - 31*day).toISOString() },
                      { name: 'pgsql-test-flex', type: 'microsoft.dbforpostgresql/flexibleservers', resourceGroup: 'db-sandbox-rg', location: 'eastus2', owner: 'data-team@contoso.com', daysOverdue: 4, expirationDate: new Date(now - 4*day).toISOString() },
                      { name: 'demo-storage-archive', type: 'microsoft.storage/storageaccounts', resourceGroup: 'demo-archive-rg', location: 'northeurope', owner: 'finops@contoso.com', daysOverdue: 2, expirationDate: new Date(now - 2*day).toISOString() },
                      { name: 'ephemeral-redis-cache', type: 'microsoft.cache/redis', resourceGroup: 'cache-poc-rg', location: 'westus2', owner: 'platform@contoso.com', daysOverdue: 14, expirationDate: new Date(now - 14*day).toISOString() },
                      { name: 'training-workshop-vnet', type: 'microsoft.network/virtualnetworks', resourceGroup: 'training-rg', location: 'eastus', owner: 'edu@contoso.com', daysOverdue: 22, expirationDate: new Date(now - 22*day).toISOString() },
                  ];
                  const data = Array.from({length: Math.min(baseResources.length * m, 80)}).map((_, i) => {
                      const r = baseResources[i % baseResources.length];
                      const suffix = i >= baseResources.length ? `-${Math.floor(i / baseResources.length) + 1}` : '';
                      return {
                          id: `/subscriptions/mock-sub-${(i % 3) + 1}/resourceGroups/${r.resourceGroup}${suffix}/providers/${r.type}/${r.name}${suffix}`,
                          name: `${r.name}${suffix}`,
                          type: r.type,
                          resourceGroup: `${r.resourceGroup}${suffix}`,
                          subscriptionId: `mock-sub-${(i % 3) + 1}`,
                          location: r.location,
                          owner: r.owner,
                          expirationDate: r.expirationDate,
                          daysOverdue: r.daysOverdue,
                          ttlStatus: r.daysOverdue > 3 ? 'Critical' : 'Warning',
                          tags: { ExpireOn: r.expirationDate.substring(0,10), Owner: r.owner, Environment: 'Sandbox' }
                      };
                  });
                  return new Response(JSON.stringify({ success: true, mock: true, data }), {status: 200});
              }
              if (url.includes('/api/power')) {
                  // Para POSTs en DEMO: devolver respuesta explícita de simulación para
                  // que el frontend pueda mostrar "simulación" en vez de "ejecutado".
                  if (init?.method === 'POST') {
                      let parsedBody: any = {};
                      try { parsedBody = init.body ? JSON.parse(init.body as string) : {}; } catch {}
                      return new Response(JSON.stringify({
                          success: true,
                          mock: true,
                          simulated: true,
                          action: parsedBody.action,
                          message: `[DEMO] Acción "${parsedBody.action}" SIMULADA sobre ${Array.isArray(parsedBody.vms) ? parsedBody.vms.length : 0} VM(s). En un tenant real este comando se enviaría a Azure.`,
                      }), { status: 200 });
                  }
                  return new Response(JSON.stringify(getMockDataForRoute('audit_full', mockKey)), {status: 200});
              }
              if (url.includes('/api/intelligence/chargeback')) return new Response(JSON.stringify(getMockDataForRoute('chargeback', mockKey)), {status: 200});
              // AKS Chargeback debe ir ANTES que /api/intelligence/aks (substring).
              if (url.includes('/api/intelligence/aks-chargeback')) return new Response(JSON.stringify(getMockDataForRoute('aks_chargeback', mockKey)), {status: 200});
              if (url.includes('/api/intelligence/aks')) return new Response(JSON.stringify(getMockDataForRoute('aks', mockKey)), {status: 200});
              if (url.includes('/api/intelligence/zero-cost')) return new Response(JSON.stringify(getMockDataForRoute('zero_cost', mockKey)), {status: 200});
              if (url.includes('/api/intelligence/unit-economics')) return new Response(JSON.stringify(getMockDataForRoute('unit_economics', mockKey)), {status: 200});
              if (url.includes('/api/intelligence/scorecard')) return new Response(JSON.stringify(getMockDataForRoute('scorecard', mockKey)), {status: 200});
              if (url.includes('/api/intelligence/whiteboard')) return new Response(JSON.stringify(getMockDataForRoute('white_board', mockKey)), {status: 200});
              if (url.includes('/api/intelligence/cost-centers')) return new Response(JSON.stringify(getMockDataForRoute('cost_centers', mockKey)), {status: 200});
              if (url.includes('/api/intelligence/captured-savings')) return new Response(JSON.stringify(getMockDataForRoute('captured_savings', mockKey)), {status: 200});
              if (url.includes('/api/intelligence/commitments')) {
                  const m = (selectedTenant?.tier?.toLowerCase()==='enterprise')?50:(selectedTenant?.tier?.toLowerCase()==='business')?10:(selectedTenant?.tier?.toLowerCase()==='pro')?3:1;
                  return new Response(JSON.stringify({ success: true, mock: true, data: {
                      hasReservations: true,
                      utilization: 87.4,
                      coverage: 64.2,
                      totalMonthlySavings: 4820 * m,
                      recommendations: [
                          { type: 'VirtualMachines', sku: 'Standard_D8s_v3', term: '1 Year', recommendedQuantity: 4 * m, monthlySavings: 448 * m },
                          { type: 'VirtualMachines', sku: 'Standard_D8s_v3', term: '3 Year', recommendedQuantity: 4 * m, monthlySavings: 650 * m },
                          { type: 'VirtualMachines', sku: 'Standard_E8s_v4', term: '1 Year', recommendedQuantity: 2 * m, monthlySavings: 336 * m },
                          { type: 'VirtualMachines', sku: 'Standard_E16s_v5', term: '3 Year', recommendedQuantity: 1 * m, monthlySavings: 534 * m },
                          { type: 'VirtualMachines', sku: 'Standard_F4s_v2', term: '1 Year', recommendedQuantity: 3 * m, monthlySavings: 234 * m },
                          { type: 'VirtualMachines', sku: 'Standard_D4s_v5', term: '3 Year', recommendedQuantity: 6 * m, monthlySavings: 609 * m },
                          { type: 'SQLDatabase', sku: 'vCore_Gen5_8', term: '1 Year', recommendedQuantity: 2 * m, monthlySavings: 680 * m },
                          { type: 'SQLDatabase', sku: 'vCore_Gen5_4', term: '3 Year', recommendedQuantity: 3 * m, monthlySavings: 739 * m },
                          { type: 'CosmosDB', sku: 'RU_10000', term: '1 Year', recommendedQuantity: 1 * m, monthlySavings: 234 * m },
                          { type: 'RedisCache', sku: 'Premium_P2', term: '3 Year', recommendedQuantity: 2 * m, monthlySavings: 476 * m },
                          { type: 'SynapseAnalytics', sku: 'DW500c', term: '3 Year', recommendedQuantity: 1 * m, monthlySavings: 3341 * m },
                          { type: 'AppService', sku: 'P1v3', term: '1 Year', recommendedQuantity: 4 * m, monthlySavings: 312 * m },
                          { type: 'SavingsPlan', sku: 'Compute (1Y)', term: '1 Year', recommendedQuantity: 1, monthlySavings: 1240 * m },
                          { type: 'SavingsPlan', sku: 'Compute (3Y)', term: '3 Year', recommendedQuantity: 1, monthlySavings: 2890 * m }
                      ]
                  }}), {status: 200});
              }
              if (url.includes('/api/intelligence/hybrid-benefit')) {
                  const m = (Number((selectedTenant?.tier?.toLowerCase()==='enterprise')?50:(selectedTenant?.tier?.toLowerCase()==='business')?10:(selectedTenant?.tier?.toLowerCase()==='pro')?3:1));
                  const eligibleResources = [
                      { id: 'r1', name: 'app-prod-vm-01', type: 'Windows Server VM', currentCost: 290 * m, ahbCost: 145 * m, savings: 145 * m },
                      { id: 'r2', name: 'app-prod-vm-02', type: 'Windows Server VM', currentCost: 290 * m, ahbCost: 145 * m, savings: 145 * m },
                      { id: 'r3', name: 'web-iis-srv-01', type: 'Windows Server VM', currentCost: 174 * m, ahbCost: 87 * m, savings: 87 * m },
                      { id: 'r4', name: 'sqldb-main', type: 'SQL Database (BC 8 vCore)', currentCost: 882 * m, ahbCost: 441 * m, savings: 441 * m },
                      { id: 'r5', name: 'sqldb-reports', type: 'SQL Database (GP 4 vCore)', currentCost: 441 * m, ahbCost: 220.5 * m, savings: 220.5 * m },
                      { id: 'r6', name: 'sqlpool-shared', type: 'SQL Elastic Pool', currentCost: 640.8 * m, ahbCost: 320.4 * m, savings: 320.4 * m }
                  ];
                  const totalPotentialSavings = eligibleResources.reduce((s, r) => s + r.savings, 0);
                  return new Response(JSON.stringify({ success: true, mock: true, data: { eligibleResources, totalPotentialSavings } }), {status: 200});
              }
              if (url.includes('/api/intelligence/licenses')) return new Response(JSON.stringify(getMockDataForRoute('licenses', mockKey)), {status: 200});
              if (url.includes('/api/intelligence/rightsizing')) return new Response(JSON.stringify(getMockDataForRoute('rightsizing', mockKey)), {status: 200});
              if (url.includes('/api/intelligence/anomalies')) return new Response(JSON.stringify(getMockDataForRoute('anomalies', mockKey)), {status: 200});
              if (url.includes('/api/intelligence/kpis/coin')) {
                  if (init?.method === 'POST') return new Response(JSON.stringify({ success: true, mock: true, expiresAt: null }), {status: 200});
                  return new Response(JSON.stringify(getMockDataForRoute('coin', mockKey)), {status: 200});
              }
              if (url.includes('/api/intelligence/tenant-health')) return new Response(JSON.stringify(getMockDataForRoute('tenant_health', mockKey)), {status: 200});
              // entra-sync ANTES que /api/admin/config/users (substring): trae forma
              // Graph (mail/userPrincipalName/displayName), no la de usuarios locales.
              if (url.includes('/api/admin/config/users/entra-sync')) {
                  return new Response(JSON.stringify({
                      success: true,
                      users: [
                          { id: 'entra-demo-oid-4', displayName: 'Ana Torres', mail: 'ana.torres@empresa-demo.com', userPrincipalName: 'ana.torres@empresa-demo.com' },
                          { id: 'entra-demo-oid-5', displayName: 'Bruno Ríos', mail: 'bruno.rios@empresa-demo.com', userPrincipalName: 'bruno.rios@empresa-demo.com' },
                          { id: 'entra-demo-oid-6', displayName: 'Carla Núñez', mail: null, userPrincipalName: 'carla.nunez@empresa-demo.com' },
                      ],
                  }), { status: 200 });
              }
              if (url.includes('/api/admin/config/users')) return new Response(JSON.stringify(getMockDataForRoute('users', mockKey)), {status: 200});
              if (url.includes('/api/tags') && !url.includes('/api/tags/compliance')) return new Response(JSON.stringify(getMockDataForRoute('tags', mockKey)), {status: 200});
              if (url.includes('/api/intelligence/sustainability')) return new Response(JSON.stringify(getMockDataForRoute('sustainability', mockKey)), {status: 200});
              if (url.includes('/api/governance/policies')) return new Response(JSON.stringify(getMockDataForRoute('governance-policies', mockKey)), {status: 200});
              if (url.includes('/api/remediation/workflow')) return new Response(JSON.stringify(getMockDataForRoute('approvals', mockKey)), {status: 200});
              if (url.includes('/api/billing/portal')) return new Response(JSON.stringify(getMockDataForRoute('payments', mockKey)), {status: 200});
              if (url.includes('/api/billing/plan')) {
                  const tierCap = tier.charAt(0).toUpperCase() + tier.slice(1);
                  return new Response(JSON.stringify({
                      tier: tierCap, status: 'ACTIVE', trialEndsAt: null,
                      paddleSubscriptionId: 'sub_demo_0001',
                      marketplaceSource: 'direct', marketplaceSubscriptionId: null, marketplacePlanId: null,
                      isEnterprise: tierCap === 'Enterprise',
                  }), { status: 200 });
              }
              if (url.includes('/api/billing/invoices')) {
                  const m = tier === 'enterprise' ? 50 : tier === 'business' ? 10 : tier === 'pro' ? 3 : 1;
                  const invoices = Array.from({ length: 3 }).map((_, i) => ({
                      id: i + 1,
                      transactionId: `txn_demo_000${i + 1}`,
                      amount: 29900 * m,
                      currency: 'USD',
                      status: 'paid',
                      billedAt: new Date(Date.now() - i * 30 * 86400000).toISOString(),
                  }));
                  return new Response(JSON.stringify({ success: true, invoices, count: invoices.length }), { status: 200 });
              }
              if (url.includes('/api/dashboard/summary')) return new Response(JSON.stringify(getMockDataForRoute('dashboard_summary', mockKey)), {status: 200});
              if (url.includes('/api/intelligence/applied-savings')) {
                  const m = tier === 'enterprise' ? 50 : tier === 'business' ? 10 : tier === 'pro' ? 3 : 1;
                  return new Response(JSON.stringify({ success: true, mock: true, appliedSavings: 380.5 * m, actionsCount: 6 }), { status: 200 });
              }
              if (url.includes('/api/intelligence/allocation-rules')) return new Response(JSON.stringify(getMockDataForRoute('allocation-rules', mockKey)), {status: 200});
              if (url.includes('/api/intelligence/cost-by-category')) return new Response(JSON.stringify(getMockDataForRoute('cost-by-category', mockKey)), {status: 200});
              if (url.includes('/api/intelligence/cost-projection')) return new Response(JSON.stringify(getMockDataForRoute('cost-projection', mockKey)), {status: 200});
              if (url.includes('/api/intelligence/commitment-simulator')) return new Response(JSON.stringify(getMockDataForRoute('commitment-simulator', mockKey)), {status: 200});
              if (url.includes('/api/intelligence/compute-efficiency')) return new Response(JSON.stringify(getMockDataForRoute('compute-efficiency', mockKey)), {status: 200});
              // Simulador What-If: reproduce la misma matemática pura de
              // src/lib/simulator/engine.ts (compute 60% / storage 25% / network 15%,
              // AHB -18%) para que el POST no dependa de un JWT real.
              if (url.includes('/api/intelligence/simulator/scenarios')) {
                  return new Response(JSON.stringify({ success: true, scenarios: [] }), { status: 200 });
              }
              if (url.includes('/api/intelligence/simulator')) {
                  // GET precarga el campo editable "Costo Base" del simulador —
                  // usa el mismo "Costo Actual" que ya muestra el Dashboard
                  // (dashboard_summary) para que la demo sea consistente entre
                  // pantallas. Sin este branch, un GET (sin body) caía en la
                  // rama POST de abajo con baseCost hardcodeado en 25000.
                  const method = (init?.method || 'GET').toUpperCase();
                  if (method === 'GET') {
                      const summary = getMockDataForRoute('dashboard_summary', mockKey) as { actualCost?: number };
                      return new Response(JSON.stringify({ success: true, baseCost: summary?.actualCost ?? 25000 }), { status: 200 });
                  }
                  let parsedBody: any = {};
                  try { parsedBody = init?.body ? JSON.parse(init.body as string) : {}; } catch {}
                  const scenario = parsedBody.scenario || {};
                  const baseCost = (typeof scenario.baseCost === 'number' && scenario.baseCost > 0) ? scenario.baseCost : 25000;
                  const computeScale = Number.isFinite(scenario.computeScale) ? scenario.computeScale : 1;
                  const storageScale = Number.isFinite(scenario.storageScale) ? scenario.storageScale : 1;
                  const networkIncrease = Number.isFinite(scenario.networkIncrease) ? scenario.networkIncrease : 0;
                  const applyAhb = Boolean(scenario.applyAhb);
                  const compute = baseCost * 0.60 * computeScale;
                  const storage = baseCost * 0.25 * storageScale;
                  const network = baseCost * 0.15 * (1 + networkIncrease / 100);
                  let projected = compute + storage + network;
                  if (applyAhb) projected *= 0.82;
                  const round2 = (n: number) => Math.round(n * 100) / 100;
                  const baseRounded = round2(baseCost);
                  const projectedRounded = round2(projected);
                  const delta = round2(projectedRounded - baseRounded);
                  const deltaPct = baseRounded > 0 ? Math.round((delta / baseRounded) * 1000) / 10 : 0;
                  return new Response(JSON.stringify({
                      success: true, mock: true,
                      simulation: {
                          baseCost: baseRounded, projectedCost: projectedRounded, delta, deltaPct,
                          breakdown: { compute: round2(compute), storage: round2(storage), network: round2(network) },
                      },
                      inputs: { computeScale, storageScale, networkIncrease, applyAhb },
                  }), { status: 200 });
              }
              if (url.includes('/api/admin/governance-policies')) return new Response(JSON.stringify(getMockDataForRoute('governance-policies', mockKey)), {status: 200});
              if (url.includes('/api/admin/billing-markup')) return new Response(JSON.stringify(getMockDataForRoute('billing-markup', mockKey)), {status: 200});
              if (url.includes('/api/copilot-m365/ask')) {
                  return new Response(JSON.stringify({
                      success: true, mock: true,
                      question: 'Demo question',
                      answer: 'Esta es una respuesta DEMO del agente M365. En producción, Copilot Studio consultará los datos indexados por el conector Graph para responder con cifras reales.',
                  }), { status: 200 });
              }
              if (url.includes('/api/copilot-m365')) {
                  const enabled = tier === 'enterprise' || tier === 'business';
                  const m = tier === 'enterprise' ? 5 : tier === 'business' ? 2 : 1;
                  return new Response(JSON.stringify({
                      success: true, mock: true,
                      enabled,
                      config: {
                          tenantId: selectedTenant?.id || 'demo',
                          status: enabled ? 'ready' : 'not_configured',
                          connectorId: enabled ? 'conn-demo-001' : null,
                          copilotStudioAgentId: enabled ? 'agent-finops-demo' : null,
                          indexedRecords: enabled ? 18450 * m : 0,
                          lastIndexAt: enabled ? new Date(Date.now() - 3600000).toISOString() : null,
                          config: enabled ? { namespaceFilter: ['costs', 'budgets', 'anomalies', 'recommendations'], refreshHours: 24 } : null,
                      }
                  }), { status: 200 });
              }
              if (url.includes('/api/onboard/lighthouse')) return new Response(JSON.stringify({ mock: true, armTemplate: { '$schema':'https://schema.management.azure.com/schemas/2018-05-01/subscriptionDeploymentTemplate.json', contentVersion:'1.0.0.0', resources:[] } }), {status: 200});
              if (url.includes('/api/intelligence/storage-efficiency')) {
                  const m = (selectedTenant?.tier?.toLowerCase()==='enterprise')?50:(selectedTenant?.tier?.toLowerCase()==='business')?10:(selectedTenant?.tier?.toLowerCase()==='pro')?3:1;
                  const hotGb = 12500 * m, coolGb = 5000 * m, coldGb = 1600 * m, archGb = 1000 * m;
                  const hotCost = hotGb * 0.0184, coolCost = coolGb * 0.01, coldCost = coldGb * 0.0036, archCost = archGb * 0.00099;
                  const totalGb = hotGb + coolGb + coldGb + archGb;
                  const totalCost = hotCost + coolCost + coldCost + archCost;
                  const movableGb = Math.round(hotGb * 0.28);
                  const potentialSavings = parseFloat(((0.0184 - 0.01) * movableGb).toFixed(2));
                  return new Response(JSON.stringify({
                      success: true, mock: true,
                      tiers: {
                          hot:     { percent: Math.round(hotGb/totalGb*100),  gb: hotGb,  cost: parseFloat(hotCost.toFixed(2)) },
                          cool:    { percent: Math.round(coolGb/totalGb*100), gb: coolGb, cost: parseFloat(coolCost.toFixed(2)) },
                          cold:    { percent: Math.round(coldGb/totalGb*100), gb: coldGb, cost: parseFloat(coldCost.toFixed(2)) },
                          archive: { percent: Math.round(archGb/totalGb*100), gb: archGb, cost: parseFloat(archCost.toFixed(2)) }
                      },
                      totalGb,
                      totalCost: parseFloat(totalCost.toFixed(2)),
                      costPerGb: parseFloat((totalCost/totalGb).toFixed(5)),
                      recommendation: { movableGb, potentialSavings, fromTier: 'hot', toTier: 'cool' }
                  }), {status: 200});
              }
              if (url.includes('/api/governance/reporting')) return new Response(JSON.stringify(getMockDataForRoute('governance-reporting', mockKey)), {status: 200});
              {
                  const costGroupDetailMatch = url.match(/\/api\/cost-groups\/([^/?]+)/);
                  if (costGroupDetailMatch) {
                      return new Response(JSON.stringify(getMockCostGroupDetail(decodeURIComponent(costGroupDetailMatch[1]), tier)), {status: 200});
                  }
              }
              if (url.includes('/api/cost-groups')) return new Response(JSON.stringify(getMockDataForRoute('cost_groups', mockKey)), {status: 200});
              if (url.includes('/api/intelligence/top-expenses')) return new Response(JSON.stringify(getMockDataForRoute('top_expenses', mockKey)), {status: 200});
              if (url.includes('/api/resources/search')) return new Response(JSON.stringify(getMockDataForRoute('resources_search', mockKey)), {status: 200});
              if (url.includes('/api/resources/inventory')) return new Response(JSON.stringify(getMockDataForRoute('resources_inventory', mockKey)), {status: 200});
              if (url.includes('/api/resources/created-by')) return new Response(JSON.stringify(getMockDataForRoute('resources_created_by', mockKey)), {status: 200});
              if (url.includes('/api/resources/costs-by-tag')) return new Response(JSON.stringify(getMockDataForRoute('resources_costs_by_tag', mockKey)), {status: 200});
              if (url.includes('/api/m365/overview')) return new Response(JSON.stringify(getMockDataForRoute('m365_overview', mockKey)), {status: 200});
              if (url.includes('/api/m365/user-activity')) return new Response(JSON.stringify(getMockDataForRoute('m365_user_activity', mockKey)), {status: 200});
              if (url.includes('/api/governance/ha')) {
                  const m = (selectedTenant?.tier?.toLowerCase()==='enterprise')?5:(selectedTenant?.tier?.toLowerCase()==='business')?2:1;
                  const baseItems = [
                      { resourceId: '/subscriptions/mock-sub-1/resourceGroups/rg-prod/providers/Microsoft.Compute/virtualMachines/vm-payments-01', resourceName: 'vm-payments-01', resourceType: 'Microsoft.Compute/virtualMachines', issueType: 'no_zone', severity: 'critical', estimatedRisk: 'VM productiva del API de Payments en eastus sin zona ni Availability Set: caída zonal = pérdida total' },
                      { resourceId: '/subscriptions/mock-sub-1/resourceGroups/rg-prod/providers/Microsoft.Compute/virtualMachines/vm-payments-02', resourceName: 'vm-payments-02', resourceType: 'Microsoft.Compute/virtualMachines', issueType: 'no_zone', severity: 'critical', estimatedRisk: 'Segunda VM del cluster Payments en la misma zona implícita' },
                      { resourceId: '/subscriptions/mock-sub-1/resourceGroups/rg-prod/providers/Microsoft.Compute/virtualMachines/vm-db-prod-01', resourceName: 'vm-db-prod-01', resourceType: 'Microsoft.Compute/virtualMachines', issueType: 'no_backup', severity: 'critical', estimatedRisk: 'SQL Server self-hosted en VM sin política de backup en Recovery Services Vault' },
                      { resourceId: '/subscriptions/mock-sub-2/resourceGroups/rg-data/providers/Microsoft.Sql/servers/sql-finance', resourceName: 'sql-finance', resourceType: 'Microsoft.Sql/servers', issueType: 'no_geo_redundancy', severity: 'critical', estimatedRisk: 'SQL Finance sin failover group ni geo-replica activa' },
                      { resourceId: '/subscriptions/mock-sub-1/resourceGroups/rg-prod/providers/Microsoft.Compute/virtualMachines/vm-api-app-01', resourceName: 'vm-api-app-01', resourceType: 'Microsoft.Compute/virtualMachines', issueType: 'no_availability_set', severity: 'high', estimatedRisk: 'API tier en single host sin Availability Set ni VMSS' },
                      { resourceId: '/subscriptions/mock-sub-1/resourceGroups/rg-prod/providers/Microsoft.ContainerService/managedClusters/aks-prod-east', resourceName: 'aks-prod-east', resourceType: 'Microsoft.ContainerService/managedClusters', issueType: 'no_zone', severity: 'high', estimatedRisk: 'AKS sin agent pool profiles zonales en eastus' },
                      { resourceId: '/subscriptions/mock-sub-1/resourceGroups/rg-web/providers/Microsoft.Web/serverfarms/asp-portal-prod', resourceName: 'asp-portal-prod', resourceType: 'Microsoft.Web/serverfarms', issueType: 'low_capacity', severity: 'high', estimatedRisk: 'App Service Plan productivo con capacidad 1 (single-instance)' },
                      { resourceId: '/subscriptions/mock-sub-1/resourceGroups/rg-data/providers/Microsoft.DocumentDB/databaseAccounts/cosmos-orders', resourceName: 'cosmos-orders', resourceType: 'Microsoft.DocumentDB/databaseAccounts', issueType: 'no_geo_redundancy', severity: 'high', estimatedRisk: 'Cosmos DB con una sola región write configurada' },
                      { resourceId: '/subscriptions/mock-sub-1/resourceGroups/rg-data/providers/Microsoft.DBforPostgreSQL/flexibleServers/pg-events', resourceName: 'pg-events', resourceType: 'Microsoft.DBforPostgreSQL/flexibleServers', issueType: 'no_geo_redundancy', severity: 'high', estimatedRisk: 'Postgres Flexible sin Zone-Redundant HA habilitado' },
                      { resourceId: '/subscriptions/mock-sub-2/resourceGroups/rg-network/providers/Microsoft.Network/publicIPAddresses/pip-lb-front', resourceName: 'pip-lb-front', resourceType: 'Microsoft.Network/publicIPAddresses', issueType: 'basic_sku', severity: 'medium', estimatedRisk: 'Public IP Basic SKU no soporta zonas ni reglas SLA' },
                      { resourceId: '/subscriptions/mock-sub-2/resourceGroups/rg-network/providers/Microsoft.Network/publicIPAddresses/pip-vpn-gw', resourceName: 'pip-vpn-gw', resourceType: 'Microsoft.Network/publicIPAddresses', issueType: 'basic_sku', severity: 'medium', estimatedRisk: 'Public IP de VPN Gateway con SKU Basic' },
                      { resourceId: '/subscriptions/mock-sub-3/resourceGroups/rg-cache/providers/Microsoft.Cache/Redis/redis-sessions', resourceName: 'redis-sessions', resourceType: 'Microsoft.Cache/Redis', issueType: 'low_capacity', severity: 'medium', estimatedRisk: 'Redis Standard (sin SLA de Premium zonal/geo)' },
                      { resourceId: '/subscriptions/mock-sub-1/resourceGroups/rg-prod/providers/Microsoft.Sql/servers/sql-app-prod', resourceName: 'sql-app-prod', resourceType: 'Microsoft.Sql/servers', issueType: 'no_geo_redundancy', severity: 'medium', estimatedRisk: 'SQL App sin geo-replicación, solo backup local' },
                      { resourceId: '/subscriptions/mock-sub-3/resourceGroups/rg-data/providers/Microsoft.DBforMySQL/flexibleServers/mysql-cms', resourceName: 'mysql-cms', resourceType: 'Microsoft.DBforMySQL/flexibleServers', issueType: 'no_geo_redundancy', severity: 'medium', estimatedRisk: 'MySQL Flexible sin HA habilitada' },
                      { resourceId: '/subscriptions/mock-sub-1/resourceGroups/rg-prod/providers/Microsoft.Web/serverfarms/asp-api-prod', resourceName: 'asp-api-prod', resourceType: 'Microsoft.Web/serverfarms', issueType: 'low_capacity', severity: 'medium', estimatedRisk: 'App Service Plan API con capacidad 1' },
                      { resourceId: '/subscriptions/mock-sub-1/resourceGroups/rg-prod/providers/Microsoft.Storage/storageAccounts/sapaymentlogs', resourceName: 'sapaymentlogs', resourceType: 'Microsoft.Storage/storageAccounts', issueType: 'single_replica', severity: 'low', estimatedRisk: 'Storage con redundancia Standard_LRS, considerar ZRS' },
                      { resourceId: '/subscriptions/mock-sub-2/resourceGroups/rg-archive/providers/Microsoft.Storage/storageAccounts/saarchive01', resourceName: 'saarchive01', resourceType: 'Microsoft.Storage/storageAccounts', issueType: 'single_replica', severity: 'low', estimatedRisk: 'Archive storage con LRS, datos críticos sin geo-replicación' },
                      { resourceId: '/subscriptions/mock-sub-2/resourceGroups/rg-backup/providers/Microsoft.Storage/storageAccounts/sabackupdb', resourceName: 'sabackupdb', resourceType: 'Microsoft.Storage/storageAccounts', issueType: 'single_replica', severity: 'low', estimatedRisk: 'Storage de backups con Premium_LRS (sin geo)' },
                      { resourceId: '/subscriptions/mock-sub-3/resourceGroups/rg-dev/providers/Microsoft.Storage/storageAccounts/sadevstatic', resourceName: 'sadevstatic', resourceType: 'Microsoft.Storage/storageAccounts', issueType: 'single_replica', severity: 'low', estimatedRisk: 'Static website storage LRS' },
                      { resourceId: '/subscriptions/mock-sub-2/resourceGroups/rg-test/providers/Microsoft.Compute/virtualMachines/vm-test-bench', resourceName: 'vm-test-bench', resourceType: 'Microsoft.Compute/virtualMachines', issueType: 'no_availability_set', severity: 'low', estimatedRisk: 'VM de benchmark/test sin AS (no productivo)' },
                  ];
                  const items: any[] = [];
                  for (let k = 0; k < m; k++) {
                      baseItems.forEach((it, idx) => {
                          const suffix = k === 0 ? '' : `-${k+1}`;
                          items.push({
                              ...it,
                              resourceId: it.resourceId + suffix,
                              resourceName: it.resourceName + suffix,
                          });
                      });
                  }
                  const counts: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0 };
                  items.forEach(it => { if (it.severity in counts) counts[it.severity]++; });
                  return new Response(JSON.stringify({ success: true, mock: true, source: 'mock', items, counts }), {status: 200});
              }
              if (url.includes('/api/intelligence/compute-cost-per-core')) return new Response(JSON.stringify(getMockDataForRoute('compute-efficiency', mockKey)), {status: 200});
              if (url.includes('/api/intelligence/macc')) return new Response(JSON.stringify(getMockDataForRoute('macc', mockKey)), {status: 200});

              // ===== Bloque demo: features admin / gobernanza / analytics faltantes =====
              {
                  const dm = tier === 'enterprise' ? 50 : tier === 'business' ? 10 : tier === 'pro' ? 3 : 1;
                  const nowMs = Date.now();
                  const dayMs = 86400000;

                  // AI Cost Analytics
                  if (url.includes('/api/intelligence/ai-analytics')) return new Response(JSON.stringify(getMockDataForRoute('ai-analytics', mockKey)), { status: 200 });

                  // Credenciales por expirar
                  if (url.includes('/api/governance/expiring-credentials')) {
                      const samples = [
                          { displayName: 'finops-onboarding-sp', credentialType: 'password' as const, days: 2 },
                          { displayName: 'github-actions-cicd', credentialType: 'certificate' as const, days: 12 },
                          { displayName: 'data-ingest-job', credentialType: 'password' as const, days: 28 },
                          { displayName: 'monitoring-sp', credentialType: 'certificate' as const, days: 65 },
                      ];
                      const sev = (d: number) => (d <= 7 ? 'critical' : d <= 30 ? 'high' : d <= 60 ? 'medium' : 'low');
                      const items = samples.map((s, i) => ({
                          appId: `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`,
                          displayName: s.displayName,
                          credentialType: s.credentialType,
                          credentialId: `cred-${i}`,
                          expiresAt: new Date(nowMs + s.days * dayMs).toISOString(),
                          daysTillExpiry: s.days,
                          severity: sev(s.days),
                      }));
                      const counts = { critical: 0, high: 0, medium: 0, low: 0 } as Record<string, number>;
                      items.forEach((it) => { counts[it.severity]++; });
                      return new Response(JSON.stringify({ success: true, mock: true, items, counts }), { status: 200 });
                  }

                  // Notificaciones (canales)
                  if (url.includes('/api/admin/notifications/channels')) {
                      if (init?.method && init.method !== 'GET') return new Response(JSON.stringify({ success: true, mock: true, id: Date.now() }), { status: 200 });
                      return new Response(JSON.stringify({ success: true, mock: true, channels: [
                          { id: 1, type: 'slack', name: 'FinOps Alerts', severity_filter: 'high', enabled: 1, created_at: new Date(nowMs - 30 * dayMs).toISOString(), updated_at: new Date(nowMs - 2 * dayMs).toISOString() },
                          { id: 2, type: 'teams', name: 'Ops On-Call', severity_filter: 'critical', enabled: 1, created_at: new Date(nowMs - 60 * dayMs).toISOString(), updated_at: new Date(nowMs - 5 * dayMs).toISOString() },
                          { id: 3, type: 'email', name: 'Finance Digest', severity_filter: 'medium', enabled: 0, created_at: new Date(nowMs - 90 * dayMs).toISOString(), updated_at: new Date(nowMs - 10 * dayMs).toISOString() },
                      ] }), { status: 200 });
                  }

                  // Azure Policy definitions (Políticas as Code — Enterprise)
                  if (url.includes('/api/admin/azure-policies')) {
                      return new Response(JSON.stringify({ success: true, mock: true, data: [
                          { id: '/providers/Microsoft.Authorization/policyDefinitions/mock-1', displayName: 'Requiere Etiqueta Específica', description: 'Fuerza la existencia de una etiqueta en los recursos.', parameters: { tagName: { type: 'String', metadata: { displayName: 'Tag Name', description: 'Name of the tag to require' } } } },
                          { id: '/providers/Microsoft.Authorization/policyDefinitions/mock-2', displayName: 'Allowed Locations', description: 'Fuerza que los recursos solo se creen en ciertas regiones.', parameters: { listOfAllowedLocations: { type: 'Array', metadata: { displayName: 'Allowed locations', description: 'The list of allowed locations for resources.' } } } },
                          { id: '/providers/Microsoft.Authorization/policyDefinitions/mock-3', displayName: 'Allowed Virtual Machine Size SKUs', description: 'Restringe qué tamaños de VM se pueden crear.', parameters: { listOfAllowedSKUs: { type: 'Array', metadata: { displayName: 'Allowed Size SKUs' } } } },
                          { id: '/providers/Microsoft.Authorization/policyDefinitions/mock-4', displayName: 'Storage Accounts must disable public network access', description: 'Mejora la seguridad bloqueando el acceso público a Storage Accounts.', parameters: {} },
                      ] }), { status: 200 });
                  }

                  // SSO SAML
                  if (url.includes('/api/admin/sso')) {
                      if (init?.method && init.method !== 'GET') return new Response(JSON.stringify({ success: true, mock: true }), { status: 200 });
                      const enabled = tier === 'enterprise' || tier === 'business';
                      return new Response(JSON.stringify({ success: true, config: {
                          tenant_id: 'demo',
                          workos_org_id: enabled ? 'org_demo_123' : null,
                          workos_connection_id: enabled ? 'conn_demo_456' : null,
                          domain: enabled ? 'contoso.com' : null,
                          enabled,
                      } }), { status: 200 });
                  }

                  // Data residency
                  if (url.includes('/api/admin/data-residency')) {
                      if (init?.method && init.method !== 'GET') return new Response(JSON.stringify({ success: true, mock: true }), { status: 200 });
                      return new Response(JSON.stringify({
                          region: 'LATAM',
                          locked_at: new Date(nowMs - 200 * dayMs).toISOString(),
                          can_change: false,
                          available_regions: ['US', 'EU', 'LATAM', 'APAC', 'GLOBAL'],
                      }), { status: 200 });
                  }

                  // Webhook config
                  if (url.includes('/api/admin/config/webhook')) {
                      if (init?.method && init.method !== 'GET') return new Response(JSON.stringify({ success: true, mock: true }), { status: 200 });
                      return new Response(JSON.stringify({ webhook_url: 'https://hooks.demo.finops/incoming/xxxxx' }), { status: 200 });
                  }

                  // AI config (guardar) — evita 401 en PATCH
                  if (url.includes('/api/admin/config/ai')) return new Response(JSON.stringify({ success: true, mock: true }), { status: 200 });

                  // FOCUS export: programación diaria
                  if (url.includes('/api/admin/focus-export/schedule')) {
                      if (init?.method && init.method !== 'GET') return new Response(JSON.stringify({ success: true, mock: true }), { status: 200 });
                      return new Response(JSON.stringify({ success: true, enabled: false, format: 'csv', subscriptionId: '', recipientEmail: '', lastRunAt: null }), { status: 200 });
                  }

                  // Pricing units
                  if (url.includes('/api/admin/pricing-units')) {
                      if (url.includes('test=')) return new Response(JSON.stringify({ success: true, input: { uom: 'demo', qty: '1' }, output: { baseUnit: 'Hour', normalizedQty: '1', display: '1 Hour', category: 'Compute', inferred: false } }), { status: 200 });
                      if (init?.method === 'POST') return new Response(JSON.stringify({ success: true, mock: true, inserted: 45, message: 'Demo reseed' }), { status: 200 });
                      return new Response(JSON.stringify({ success: true, cacheSize: 45, total: 5, items: [
                          { uom_raw: '1 Hour', block_size: '1', base_unit: 'Hour', display_unit: 'Hours', category: 'Compute' },
                          { uom_raw: '100 Hours', block_size: '100', base_unit: 'Hour', display_unit: 'Hours', category: 'Compute' },
                          { uom_raw: '1 GB/Month', block_size: '1', base_unit: 'GB', display_unit: 'GB-Month', category: 'Storage' },
                          { uom_raw: '10K Operations', block_size: '10000', base_unit: 'Operation', display_unit: 'Operations', category: 'Transactions' },
                          { uom_raw: '1 GB (egress)', block_size: '1', base_unit: 'GB', display_unit: 'GB', category: 'Networking' },
                      ] }), { status: 200 });
                  }

                  // FOCUS 1.1 export (descarga blob)
                  if (url.includes('/api/exports/focus')) {
                      const csv = [
                          'BillingAccountId,ChargePeriodStart,ServiceName,ResourceId,BilledCost,EffectiveCost,BillingCurrency',
                          'demo-ea-001,2026-06-01,Virtual Machines,/subscriptions/demo/rg/vm-prod-01,1234.56,1100.00,USD',
                          'demo-ea-001,2026-06-01,Storage,/subscriptions/demo/rg/stprod01,320.00,300.00,USD',
                          'demo-ea-001,2026-06-01,Azure Kubernetes Service,/subscriptions/demo/rg/aks-prod,890.10,820.00,USD',
                      ].join('\n');
                      return new Response(csv, { status: 200, headers: { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="focus-demo.csv"' } });
                  }

                  // Registro de auditoría
                  if (url.includes('/api/admin/audit')) {
                      const actions = ['LOGIN', 'UPDATE_BUDGET', 'CREATE_APIKEY', 'DELETE_RESOURCE', 'ASSIGN_ROLE', 'EXPORT_FOCUS'];
                      const logs = Array.from({ length: 8 }).map((_, i) => ({
                          id: i + 1,
                          user_email: ['admin@contoso.com', 'finops@contoso.com', 'ops@contoso.com'][i % 3],
                          action_type: actions[i % actions.length],
                          resource_type: 'Tenant',
                          resource_id: 'demo',
                          status: i % 5 === 0 ? 'FAILURE' : 'SUCCESS',
                          ip_address: '200.55.10.' + (10 + i),
                          created_at: new Date(nowMs - i * 3 * 3600000).toISOString(),
                      }));
                      return new Response(JSON.stringify({ logs, total: 128, limit: 10, offset: 0, hasMore: true }), { status: 200 });
                  }

                  // MCP API keys
                  if (url.includes('/api/admin/mcp-keys')) {
                      if (init?.method === 'POST') return new Response(JSON.stringify({ success: true, mock: true, key: 'mcp_live_demo_' + Math.random().toString(36).slice(2, 18), key_prefix: 'mcp_demo' }), { status: 200 });
                      if (init?.method === 'DELETE') return new Response(JSON.stringify({ success: true, mock: true }), { status: 200 });
                      return new Response(JSON.stringify({ success: true, keys: [
                          { id: 1, key_prefix: 'mcp_demo1', label: 'Claude Desktop', created_by_email: 'admin@contoso.com', created_at: new Date(nowMs - 40 * dayMs).toISOString(), last_used_at: new Date(nowMs - 2 * dayMs).toISOString(), revoked_at: null },
                          { id: 2, key_prefix: 'mcp_demo2', label: 'CI Pipeline', created_by_email: 'devops@contoso.com', created_at: new Date(nowMs - 12 * dayMs).toISOString(), last_used_at: null, revoked_at: null },
                      ] }), { status: 200 });
                  }

                  // API pública
                  if (url.includes('/api/admin/public-api-keys')) {
                      if (init?.method === 'POST') return new Response(JSON.stringify({ success: true, mock: true, key: 'apk_live_demo_' + Math.random().toString(36).slice(2, 18), key_prefix: 'apk_demo' }), { status: 200 });
                      if (init?.method === 'DELETE' || init?.method === 'PATCH') return new Response(JSON.stringify({ success: true, mock: true }), { status: 200 });
                      return new Response(JSON.stringify({ success: true, keys: [
                          { id: 1, name: 'Grafana Integration', key_prefix: 'apk_demo1', scopes: ['read:cost', 'read:resources'], rate_limit_per_min: 60, enabled: 1, last_used_at: new Date(nowMs - dayMs).toISOString(), created_by: 'admin@contoso.com', created_at: new Date(nowMs - 30 * dayMs).toISOString() },
                          { id: 2, name: 'Data Warehouse ETL', key_prefix: 'apk_demo2', scopes: ['read:cost'], rate_limit_per_min: 120, enabled: 1, last_used_at: null, created_by: 'data@contoso.com', created_at: new Date(nowMs - 7 * dayMs).toISOString() },
                      ] }), { status: 200 });
                  }

                  // Resource groups (Artefactos y Workbooks)
                  if (url.includes('/api/resourcegroups')) {
                      if (init?.method === 'POST') return new Response(JSON.stringify({ success: true, mock: true, resourceGroup: { name: 'demo-rg-new', location: 'eastus' } }), { status: 200 });
                      return new Response(JSON.stringify({ success: true, resourceGroups: [
                          { name: 'rg-prod-core', location: 'eastus' },
                          { name: 'rg-data-lake', location: 'westeurope' },
                          { name: 'rg-k8s-prod', location: 'eastus' },
                          { name: 'rg-network-hub', location: 'eastus2' },
                      ] }), { status: 200 });
                  }

                  // Presupuestos (Reporte Ejecutivo usa /api/budgets)
                  if (url.includes('/api/budgets') && !url.includes('/api/budgets/burn') && !url.includes('/api/budgets/alerts')) {
                      return new Response(JSON.stringify({ budgets: [
                          { id: 1, costCenter: 'Engineering', monthlyLimit: 20000 * dm, alertThreshold: 80, currentSpend: 16400 * dm, utilization: 82 },
                          { id: 2, costCenter: 'Data & Analytics', monthlyLimit: 12000 * dm, alertThreshold: 85, currentSpend: 12600 * dm, utilization: 105 },
                          { id: 3, costCenter: 'Marketing', monthlyLimit: 5000 * dm, alertThreshold: 75, currentSpend: 3100 * dm, utilization: 62 },
                      ] }), { status: 200 });
                  }

                  // Ingesta CSV (POST)
                  if (url.includes('/api/intelligence/upload')) {
                      return new Response(JSON.stringify({ success: true, mock: true, mappedEntries: 128, assessment: '## Análisis de costos (DEMO)\n\nSe procesaron **128 filas** del CSV FOCUS v1.1.\n\n- Top servicio: Virtual Machines (42% del gasto)\n- Anomalía detectada: +23% en Storage vs. mes previo\n- Ahorro potencial estimado: **$3,450/mes** (rightsizing + reservas)\n\n*En producción este análisis lo genera el motor de IA sobre tus datos reales.*' }), { status: 200 });
                  }

                  // Onboarding: verificación de roles del SP
                  if (url.includes('/api/admin/check-sp-roles')) {
                      const roles = ['Reader', 'Cost Management Reader', 'Tag Contributor'];
                      return new Response(JSON.stringify({
                          success: true, mock: true,
                          summary: {
                              tier: tier.charAt(0).toUpperCase() + tier.slice(1),
                              totalSubscriptions: 3, okCount: 3, partialCount: 0, noRolesCount: 0,
                              requiredRoles: roles,
                              requiredCustomRole: 'FinOps Remediation',
                              spObjectId: '00000000-1111-2222-3333-444444444444',
                              reservationsAccess: { status: 'OK', hint: 'El SP tiene acceso de lectura a Reservations (Microsoft.Capacity).' },
                          },
                          globalHint: 'Todas las suscripciones tienen los roles requeridos. ✅',
                          subscriptions: [
                              { subscriptionId: 'sub-demo-001', displayName: 'Production', status: 'OK', assignedRoles: roles, missingRoles: [], customRoleRequired: true, customRoleName: 'FinOps Remediation' },
                              { subscriptionId: 'sub-demo-002', displayName: 'Staging', status: 'OK', assignedRoles: roles, missingRoles: [], customRoleRequired: true, customRoleName: 'FinOps Remediation' },
                              { subscriptionId: 'sub-demo-003', displayName: 'Sandbox', status: 'OK', assignedRoles: roles, missingRoles: [], customRoleRequired: false, customRoleName: null },
                          ],
                          timestamp: new Date().toISOString(),
                      }), { status: 200 });
                  }

                  // Onboarding: generación de script
                  if (url.includes('/api/admin/onboarding')) {
                      return new Response(JSON.stringify({ success: true, mock: true, script: '# DEMO — Script de onboarding (Azure CLI)\n# En producción este script crea el App Registration, el Service Principal\n# y asigna los roles mínimos requeridos por tu tier.\n\naz ad sp create-for-rbac --name "finops-cscloud" --role "Reader" \\\n  --scopes /subscriptions/<SUB_ID>\n\naz role assignment create --assignee <SP_APP_ID> \\\n  --role "Cost Management Reader" --scope /subscriptions/<SUB_ID>\n' }), { status: 200 });
                  }
              }

              if (url.includes('/api/admin/report/invoicing')) {
                  const invoicingMethod = (init?.method || 'GET').toUpperCase();
                  if (invoicingMethod !== 'GET') return new Response(JSON.stringify({ success: true, mock: true }), { status: 200 });

                  const invoicingData = getMockDataForRoute('invoicing_report', mockKey) as any;
                  const subFilter = new URL(url, window.location.origin).searchParams.get('subscriptionId');
                  if (subFilter && invoicingData?.lines) {
                      // Recalcula agregados/totales sobre las líneas filtradas —
                      // mismo criterio que el backend real (ver /api/admin/report/invoicing).
                      const filteredLines = invoicingData.lines.filter((l: any) => l.subscriptionId === subFilter);
                      const custMap = new Map<string, any>();
                      const invMap = new Map<string, any>();
                      const subMap = new Map<string, any>();
                      const subNameOf = (id: string) => (invoicingData.bySubscription || []).find((s: any) => s.subscriptionId === id)?.subscriptionName || id;
                      for (const l of filteredLines) {
                          const ce = custMap.get(l.customerId) || { customerId: l.customerId, customerName: l.customerName, originalCost: 0, adjustedCost: 0 };
                          ce.originalCost += l.originalCost; ce.adjustedCost += l.adjustedCost;
                          custMap.set(l.customerId, ce);
                          const ie = invMap.get(l.invoiceSectionId) || { invoiceSectionId: l.invoiceSectionId, customerId: l.customerId, cost: 0, adjusted: 0 };
                          ie.cost += l.originalCost; ie.adjusted += l.adjustedCost;
                          invMap.set(l.invoiceSectionId, ie);
                          const se = subMap.get(l.subscriptionId) || { subscriptionId: l.subscriptionId, subscriptionName: subNameOf(l.subscriptionId), originalCost: 0, adjustedCost: 0 };
                          se.originalCost += l.originalCost; se.adjustedCost += l.adjustedCost;
                          subMap.set(l.subscriptionId, se);
                      }
                      const byCustomer = Array.from(custMap.values());
                      const totalOriginal = byCustomer.reduce((s: number, c: any) => s + c.originalCost, 0);
                      const totalAdjusted = byCustomer.reduce((s: number, c: any) => s + c.adjustedCost, 0);
                      return new Response(JSON.stringify({
                          ...invoicingData,
                          lines: filteredLines,
                          byCustomer,
                          byInvoiceSection: Array.from(invMap.values()),
                          bySubscription: Array.from(subMap.values()),
                          totals: { originalCost: totalOriginal, adjustedCost: totalAdjusted, markupAmount: totalAdjusted - totalOriginal },
                      }), { status: 200 });
                  }
                  return new Response(JSON.stringify(invoicingData), { status: 200 });
              }

              if (url.includes('/api/rightsizing/')) {
                  return new Response(JSON.stringify({ mock: true, items: [], data: [], success: true }), {status: 200});
              }
              if (url.includes('/api/remediation') && !url.includes('/workflow')) return new Response(JSON.stringify({ mock: true, success: true }), {status: 200});
              return originalFetch(input, init);
          };
      } else if (typeof window !== 'undefined' && (window as any).__finopsOriginalFetch) {
          // Restore real fetch when switching back to a real tenant
          window.fetch = (window as any).__finopsOriginalFetch;
          if ((instance as any).__finopsOriginalAcquire) {
              instance.acquireTokenSilent = (instance as any).__finopsOriginalAcquire;
          }
      }
  }

  // Instalar el parche SINCRÓNICAMENTE durante el render (no solo en el
  // useEffect de abajo): React ejecuta los efectos de los componentes hijos
  // ANTES que los del padre (orden bottom-up), y useSWR dispara su primer
  // fetch en su propio useLayoutEffect interno. Si window.fetch solo se
  // parcheaba en un useEffect acá, la primera carga de una sesión demo/mock
  // pegaba contra el fetch real (sin datos) y solo funcionaba después de un
  // refresh manual — para entonces el parche ya estaba instalado de una
  // carga anterior de la pestaña. Ejecutar esto en el cuerpo del render
  // garantiza que el parche está activo antes de que cualquier hijo monte.
  // Sin ref/estado de control: la función ya es idempotente (chequea
  // __finopsOriginalFetch/__finopsOriginalAcquire antes de envolver), así que
  // llamarla en cada render no tiene costo ni efecto colateral extra.
  if (typeof window !== 'undefined' && (demoSession?.isDemo || isMockTenant(selectedTenant?.id || ''))) {
      applyDemoFetchInterception();
  }

  useEffect(() => {
      applyDemoFetchInterception();
  }, [demoSession, instance, selectedTenant?.id]);

  useEffect(() => {
      if (demoSession?.isDemo) return;
      // Fetch the role for the current tenant
      if (selectedTenant.id !== 'default' && accounts.length > 0 && inProgress === 'none') {
          const fetchRole = async () => {
              setAuthzResolved(false);
              try {
                  let idToken = await getFreshIdToken(instance, accounts[0], ['User.Read']);
                  let res = await fetch(`/api/admin/config/users?tenantId=${selectedTenant.id}`, {
                      headers: { Authorization: `Bearer ${idToken}` }
                  });
                  if (res.status === 401) {
                      const fresh = await instance.acquireTokenSilent({
                          scopes: ['User.Read'],
                          account: accounts[0],
                          forceRefresh: true
                      });
                      idToken = fresh.idToken;
                      res = await fetch(`/api/admin/config/users?tenantId=${selectedTenant.id}`, {
                          headers: { Authorization: `Bearer ${idToken}` }
                      });
                  }
                  if (res.ok) {
                      const data = await res.json();
                      if (data.isSuperAdmin) {
                          setIsAdmin(true);
                          setSystemRole('SUPERADMIN');
                      }
                      const myUser = data.users?.find((u: any) => u.entra_oid === (accounts[0].idTokenClaims as any)?.oid || u.entra_oid === accounts[0].localAccountId);
                      if (myUser) {
                          if (myUser.role) setUserRole(myUser.role);
                          setUserPermissions(parsePermissions(myUser.permissions));
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
                      if (res.status !== 401) {
                          console.error("[TenantProvider] API Error fetching role. Status:", res.status);
                      }
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
              } finally {
                  setAuthzResolved(true);
              }
          };
          fetchRole();
      } else {
          setAuthzResolved(true);
      }
  }, [selectedTenant.id, accounts, instance, isAdmin, inProgress]);

  const requiresRbacUpdate = selectedTenant?.requires_rbac_update;

  return (
    <TenantContext.Provider value={{ selectedTenant, setSelectedTenant, isAdmin, tenants: tenantsList, userRole, userPermissions, systemRole, userScope, requiresRbacUpdate, academyCertified, setAcademyCertified }}>
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
