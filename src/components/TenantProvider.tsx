"use client";
import React, { createContext, useContext, useState, useEffect } from 'react';
import { useMsal } from '@azure/msal-react';
import { getMockDataForRoute } from '@/lib/mockData';
import { usePathname, useRouter } from 'next/navigation';
import { isMockTenant } from '@/lib/mockData';
import { getFreshIdToken } from '@/lib/msalToken';

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

  // Enforce Academy completion
  useEffect(() => {
    if (selectedTenant.id !== 'default' && typeof window !== 'undefined') {
        // Skip redirect for demo/mock tenants
        if (isMockTenant(selectedTenant.id) || demoSession?.isDemo) return;

        if ((selectedTenant.is_onboarded as any) === 0 || selectedTenant.is_onboarded === false) {
            if (!pathname?.includes('/academy')) {
                // Keep the current locale
                const localeMatch = pathname?.match(/^\/([a-z]{2}(-[A-Z]{2})?)\//);
                const locale = localeMatch ? localeMatch[1] : 'en';
                router.push(`/${locale}/academy`);
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
  useEffect(() => {
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
              const tier = selectedTenantRef.current?.tier?.toLowerCase() || demoSession?.tier?.toLowerCase() || 'essential';
              if (url.includes('/api/intelligence/billing')) return new Response(JSON.stringify(getMockDataForRoute('billing', tier)), {status: 200});
              if (url.includes('/api/advisor')) return new Response(JSON.stringify(getMockDataForRoute('advisor', tier)), {status: 200});
              if (url.includes('/api/audit/full')) return new Response(JSON.stringify(getMockDataForRoute('audit_full', tier)), {status: 200});
              if (url.includes('/api/audit/ttl')) return new Response(JSON.stringify(getMockDataForRoute('ttl', tier)), {status: 200});
              if (url.includes('/api/tags/compliance')) return new Response(JSON.stringify(getMockDataForRoute('tags_compliance', tier)), {status: 200});
              if (url.includes('/api/intelligence/network')) return new Response(JSON.stringify(getMockDataForRoute('network', tier)), {status: 200});
              if (url.includes('/api/intelligence/rates')) return new Response(JSON.stringify(getMockDataForRoute('rates', tier)), {status: 200});
              if (url.includes('/api/subscriptions')) return new Response(JSON.stringify({ subscriptions: [{id: 'mock-sub', name: 'Demo Subscription'}]}), {status: 200});
              if (url.includes('/api/intelligence/budgets')) return new Response(JSON.stringify(getMockDataForRoute('budgets', tier)), {status: 200});
              if (url.includes('/api/budgets/burn')) return new Response(JSON.stringify(getMockDataForRoute('budgets_burn', tier)), {status: 200});
              if (url.includes('/api/budgets/alerts')) return new Response(JSON.stringify(getMockDataForRoute('alerts', tier)), {status: 200});
              if (url.includes('/api/intelligence/history')) return new Response(JSON.stringify(getMockDataForRoute('history', tier)), {status: 200});
              if (url.includes('/api/intelligence/forecast')) return new Response(JSON.stringify(getMockDataForRoute('forecast', tier)), {status: 200});
              if (url.includes('/api/intelligence/maturity')) return new Response(JSON.stringify(getMockDataForRoute('maturity', tier)), {status: 200});
              if (url.includes('/api/cleanup/zombies')) return new Response(JSON.stringify(getMockDataForRoute('audit_full', tier)), {status: 200});
              if (url.includes('/api/cleanup/ttl')) {
                  const m = (selectedTenantRef.current?.tier?.toLowerCase()==='enterprise')?50:(selectedTenantRef.current?.tier?.toLowerCase()==='business')?10:(selectedTenantRef.current?.tier?.toLowerCase()==='pro')?3:1;
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
                  return new Response(JSON.stringify(getMockDataForRoute('schedules', tier)), {status: 200});
              }
              if (url.includes('/api/intelligence/chargeback')) return new Response(JSON.stringify(getMockDataForRoute('chargeback', tier)), {status: 200});
              if (url.includes('/api/intelligence/commitments')) {
                  const m = (selectedTenantRef.current?.tier?.toLowerCase()==='enterprise')?50:(selectedTenantRef.current?.tier?.toLowerCase()==='business')?10:(selectedTenantRef.current?.tier?.toLowerCase()==='pro')?3:1;
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
                  const m = (Number((selectedTenantRef.current?.tier?.toLowerCase()==='enterprise')?50:(selectedTenantRef.current?.tier?.toLowerCase()==='business')?10:(selectedTenantRef.current?.tier?.toLowerCase()==='pro')?3:1));
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
              if (url.includes('/api/intelligence/licenses')) return new Response(JSON.stringify(getMockDataForRoute('licenses', tier)), {status: 200});
              if (url.includes('/api/intelligence/rightsizing')) return new Response(JSON.stringify(getMockDataForRoute('rightsizing', tier)), {status: 200});
              if (url.includes('/api/intelligence/anomalies')) return new Response(JSON.stringify(getMockDataForRoute('anomalies', tier)), {status: 200});
              if (url.includes('/api/admin/config/users')) return new Response(JSON.stringify(getMockDataForRoute('users', tier)), {status: 200});
              if (url.includes('/api/tags') && !url.includes('/api/tags/compliance')) return new Response(JSON.stringify(getMockDataForRoute('tags', tier)), {status: 200});
              if (url.includes('/api/intelligence/sustainability')) return new Response(JSON.stringify(getMockDataForRoute('sustainability', tier)), {status: 200});
              if (url.includes('/api/governance/policies')) return new Response(JSON.stringify(getMockDataForRoute('governance-policies', tier)), {status: 200});
              if (url.includes('/api/remediation/workflow')) return new Response(JSON.stringify(getMockDataForRoute('approvals', tier)), {status: 200});
              if (url.includes('/api/billing/portal')) return new Response(JSON.stringify(getMockDataForRoute('payments', tier)), {status: 200});
              if (url.includes('/api/dashboard/summary')) return new Response(JSON.stringify(getMockDataForRoute('dashboard_summary', tier)), {status: 200});
              if (url.includes('/api/intelligence/allocation-rules')) return new Response(JSON.stringify(getMockDataForRoute('allocation-rules', tier)), {status: 200});
              if (url.includes('/api/admin/governance-policies')) return new Response(JSON.stringify(getMockDataForRoute('governance-policies', tier)), {status: 200});
              if (url.includes('/api/admin/billing-markup')) return new Response(JSON.stringify(getMockDataForRoute('billing-markup', tier)), {status: 200});
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
                          tenantId: selectedTenantRef.current?.id || 'demo',
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
                  const m = (selectedTenantRef.current?.tier?.toLowerCase()==='enterprise')?50:(selectedTenantRef.current?.tier?.toLowerCase()==='business')?10:(selectedTenantRef.current?.tier?.toLowerCase()==='pro')?3:1;
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
              if (url.includes('/api/governance/ha')) {
                  const m = (selectedTenantRef.current?.tier?.toLowerCase()==='enterprise')?5:(selectedTenantRef.current?.tier?.toLowerCase()==='business')?2:1;
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
              if (url.includes('/api/intelligence/compute-cost-per-core')) return new Response(JSON.stringify(getMockDataForRoute('compute-efficiency', tier)), {status: 200});
              if (url.includes('/api/intelligence/macc')) return new Response(JSON.stringify(getMockDataForRoute('macc', tier)), {status: 200});
              if (url.includes('/api/rightsizing/') || url.includes('/api/intelligence/ai-analytics') || url.includes('/api/governance/expiring-credentials') || url.includes('/api/cleanup/zombies/networking') || url.includes('/api/admin/report/invoicing')) {
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
  }, [demoSession, instance, selectedTenant?.id]);

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
