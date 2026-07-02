"use client";
import React, { useState, useEffect } from "react";
import { Terminal, Copy, Check, Server, ShieldCheck, Database, ListChecks, AlertTriangle, CheckCircle2, XCircle, Loader2, Search, ChevronDown } from "lucide-react";
import { useTenant } from '@/components/TenantProvider';
import { useTranslations } from "next-intl";
import { useMsal } from '@azure/msal-react';
import { fetchWithAuthRetry } from '@/lib/msalToken';
import Pagination, { usePagination } from '@/components/Pagination';

export default function OnboardingPage() {
  const t = useTranslations('onboarding');
  const { selectedTenant, systemRole } = useTenant();
  const { instance, accounts } = useMsal();
  const [tenants, setTenants] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);

  // Generador State
  const [formTenantId, setFormTenantId] = useState("");
  const [formSubscriptionId, setFormSubscriptionId] = useState("");
  const [generatedScript, setGeneratedScript] = useState("");
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState(false);

  // Verificador de permisos State
  const [checkTenantId, setCheckTenantId] = useState("");
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<any | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);

  // Set the default form tenant ID when the page loads
  useEffect(() => {
      if (selectedTenant && selectedTenant.id !== 'default') {
          setFormTenantId(selectedTenant.id);
          setCheckTenantId(selectedTenant.id);
      }
  }, [selectedTenant]);

  const fetchTenants = async () => {
    if (accounts.length === 0) return;
    setLoading(true);
    try {
        const res = await fetchWithAuthRetry(instance, accounts[0], '/api/tenants');
        const data = await res.json();
        if (data.tenants) {
            setTenants(data.tenants);
        }
    } catch(e) {
        console.error('[Onboarding] fetchTenants failed:', e);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (accounts.length > 0) fetchTenants();
  }, [accounts.length]);

  const handleNameChange = (id: string, field: string, value: string) => {
      setTenants(prev => prev.map(t => t.id === id ? { ...t, [field]: value } : t));
  };

  const saveTenant = async (tenantId: string, newName: string, clientId?: string, clientSecret?: string) => {
      if (accounts.length === 0) { alert("Sesión no iniciada"); return; }
      setSavingId(tenantId);
      try {
          const res = await fetchWithAuthRetry(instance, accounts[0], '/api/tenants', {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ tenantId, name: newName, clientId, clientSecret })
          });
          if (res.ok) {
              alert("Configuración de cliente guardada con éxito.");
          } else {
              alert("Error al actualizar");
          }
      } catch (e) {
          alert("Error de red");
      }
      setSavingId(null);
  };

  const generateScript = async (e: React.FormEvent) => {
      e.preventDefault();
      if (accounts.length === 0) { alert("Debes iniciar sesión para generar el script."); return; }
      setGenerating(true);
      try {
          const res = await fetchWithAuthRetry(
              instance,
              accounts[0],
              '/api/admin/onboarding',
              {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ clientTenantId: formTenantId, subscriptionId: formSubscriptionId }),
              }
          );
          const data = await res.json();
          if (data.success) {
              setGeneratedScript(data.script);
              setCopied(false);
          } else {
              alert("Error: " + data.error);
          }
      } catch (err) {
          alert("Error de red");
      }
      setGenerating(false);
  };

  const copyToClipboard = () => {
      if (generatedScript) {
          navigator.clipboard.writeText(generatedScript);
          setCopied(true);
          setTimeout(() => setCopied(false), 3000);
      }
  };

  const runCheckSpRoles = async () => {
      if (!checkTenantId || accounts.length === 0) {
          setCheckError('Tenant requerido y debe estar logueado.');
          return;
      }
      setChecking(true);
      setCheckError(null);
      setCheckResult(null);
      try {
          const res = await fetchWithAuthRetry(
              instance,
              accounts[0],
              `/api/admin/check-sp-roles?tenantId=${encodeURIComponent(checkTenantId)}`
          );
          const data = await res.json();
          if (!res.ok) {
              setCheckError(`${data.error || 'ERROR'}: ${data.message || ''}${data.hint ? `\n💡 ${data.hint}` : ''}`);
          } else {
              setCheckResult(data);
          }
      } catch (e: any) {
          setCheckError(e.message || 'Error de red');
      }
      setChecking(false);
  };

  const statusBadge = (status: string) => {
      const map: Record<string, { color: string; icon: any; label: string }> = {
          OK: { color: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300', icon: CheckCircle2, label: 'OK' },
          PARTIAL: { color: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300', icon: AlertTriangle, label: 'Parcial' },
          NO_ROLES: { color: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300', icon: XCircle, label: 'Sin roles' },
          ERROR: { color: 'bg-gray-200 text-gray-800 dark:bg-slate-800 dark:text-gray-300', icon: AlertTriangle, label: 'Error' },
      };
      const m = map[status] || map.ERROR;
      const Icon = m.icon;
      return (
          <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold ${m.color}`}>
              <Icon className="w-3.5 h-3.5" /> {m.label}
          </span>
      );
  };

  const isSuperAdmin = systemRole === 'SUPERADMIN';
  const [adminFilterQuery, setAdminFilterQuery] = useState<string>("");
  const [expandedTenantId, setExpandedTenantId] = useState<string | null>(null);

  const displayedTenants = (() => {
      const base = isSuperAdmin ? tenants : tenants.filter(t => t.id === selectedTenant.id);
      if (!isSuperAdmin) return base;
      const q = adminFilterQuery.trim().toLowerCase();
      if (!q) return base;
      return base.filter(t =>
          (t.id || '').toLowerCase().includes(q) ||
          (t.name || '').toLowerCase().includes(q) ||
          (t.client_id || '').toLowerCase().includes(q)
      );
  })();

  const tenantPagination = usePagination(displayedTenants, 5);
  useEffect(() => { tenantPagination.setPage(1); }, [adminFilterQuery]);

  const currentTenantObj = tenants.find(t => t.id === selectedTenant?.id);
  const currentTier = currentTenantObj?.tier || 'Essential';

  return (
    <div className="max-w-6xl mx-auto p-6 animate-in fade-in duration-500">
      <div className="mb-8 border-b border-gray-200 dark:border-slate-800 pb-4">
        <h1 className="text-3xl font-extrabold text-gray-900 dark:text-white tracking-tight flex items-center">
            <ShieldCheck className="w-8 h-8 mr-3 text-indigo-600 dark:text-indigo-400" />
            Onboarding de Clientes
        </h1>
        <p className="text-gray-500 dark:text-gray-400 mt-2">Genera scripts Least-Privilege de Azure y gestiona el inventario de Tenants conectados.</p>
      </div>

      {/* Directorio de Entornos */}
      <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl shadow-sm overflow-hidden mb-8">
          <div className="px-6 py-4 border-b border-gray-200 dark:border-slate-800 bg-gray-50/50 dark:bg-slate-900/50 flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="flex items-center">
                  <Database className="w-5 h-5 text-gray-500 dark:text-gray-400 mr-2" />
                  <h3 className="text-lg font-bold text-gray-800 dark:text-gray-100">Directorio de Entornos</h3>
              </div>
              {isSuperAdmin && (
                  <div className="flex items-center gap-2 w-full md:w-auto">
                      <Search className="w-4 h-4 text-gray-400" />
                      <input
                          type="text"
                          value={adminFilterQuery}
                          onChange={(e) => setAdminFilterQuery(e.target.value)}
                          placeholder="Filtrar por Tenant ID, nombre o Client ID…"
                          className="border border-gray-300 dark:border-slate-700 dark:bg-slate-800 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 rounded-md px-3 py-1.5 text-sm focus:ring-indigo-500 focus:border-indigo-500 w-full md:w-80"
                      />
                      {adminFilterQuery && (
                          <button
                              type="button"
                              onClick={() => setAdminFilterQuery("")}
                              className="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 underline"
                          >
                              Limpiar
                          </button>
                      )}
                      <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                          {displayedTenants.length} / {tenants.length}
                      </span>
                  </div>
              )}
          </div>
          <ul className="divide-y divide-gray-200 dark:divide-slate-700">
              {tenantPagination.paged.map((tenant) => {
                  const isOpen = expandedTenantId === tenant.id;
                  return (
                      <li key={tenant.id} className="bg-white dark:bg-slate-900">
                          <button
                              type="button"
                              onClick={() => setExpandedTenantId(isOpen ? null : tenant.id)}
                              className="w-full flex items-center justify-between gap-3 px-4 sm:px-6 py-4 text-left hover:bg-gray-50 dark:hover:bg-slate-800/60 transition-colors"
                              aria-expanded={isOpen}
                          >
                              <div className="flex-1 min-w-0">
                                  <div className="text-sm font-semibold text-gray-900 dark:text-white truncate">
                                      {tenant.name || <span className="italic text-gray-400">(Sin nombre)</span>}
                                  </div>
                                  <div className="text-xs font-mono text-gray-500 dark:text-gray-400 truncate mt-0.5">
                                      {tenant.id}
                                  </div>
                              </div>
                              <ChevronDown
                                  className={`w-5 h-5 text-gray-400 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                              />
                          </button>
                          {isOpen && (
                              <div className="px-4 sm:px-6 pb-5 pt-2 bg-gray-50/60 dark:bg-slate-800/40 border-t border-gray-200 dark:border-slate-700">
                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                      <div className="md:col-span-2">
                                          <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider mb-1">Nombre del Cliente</label>
                                          <input
                                              type="text"
                                              value={tenant.name || ''}
                                              onChange={(e) => handleNameChange(tenant.id, 'name', e.target.value)}
                                              placeholder="Nombre del cliente"
                                              className="border border-gray-300 dark:border-slate-700 dark:bg-slate-800 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 rounded px-2 py-1.5 text-sm focus:ring-indigo-500 focus:border-indigo-500 w-full"
                                          />
                                      </div>
                                      <div>
                                          <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider mb-1">Client ID</label>
                                          <input
                                              type="text"
                                              placeholder="Client ID"
                                              value={tenant.client_id || ''}
                                              onChange={(e) => handleNameChange(tenant.id, 'client_id', e.target.value)}
                                              className="border border-gray-300 dark:border-slate-700 dark:bg-slate-800 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 rounded px-2 py-1.5 text-sm font-mono focus:ring-indigo-500 focus:border-indigo-500 w-full"
                                          />
                                      </div>
                                      <div>
                                          <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider mb-1">Client Secret</label>
                                          <input
                                              type="password"
                                              placeholder={tenant.has_client_secret ? "•••• (ya configurado, dejar en blanco para mantener)" : "Client Secret"}
                                              value={tenant.client_secret || ''}
                                              onChange={(e) => handleNameChange(tenant.id, 'client_secret', e.target.value)}
                                              className="border border-gray-300 dark:border-slate-700 dark:bg-slate-800 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 rounded px-2 py-1.5 text-sm font-mono focus:ring-indigo-500 focus:border-indigo-500 w-full"
                                          />
                                      </div>
                                  </div>
                                  <div className="flex justify-end mt-4">
                                      <button
                                          onClick={() => saveTenant(tenant.id, tenant.name, tenant.client_id, tenant.client_secret)}
                                          disabled={savingId === tenant.id}
                                          className="bg-gray-900 text-white px-4 py-2 rounded-md hover:bg-gray-800 transition-colors disabled:opacity-50"
                                      >
                                          {savingId === tenant.id ? 'Guardando...' : 'Guardar'}
                                      </button>
                                  </div>
                              </div>
                          )}
                      </li>
                  );
              })}
              {displayedTenants.length === 0 && !loading && (
                  <li className="px-6 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
                      {isSuperAdmin && adminFilterQuery
                          ? `Sin coincidencias para "${adminFilterQuery}".`
                          : 'El entorno no está sincronizado con la base de datos.'}
                  </li>
              )}
          </ul>
          {displayedTenants.length > 5 && (
              <div className="px-4 sm:px-6 py-3 border-t border-gray-200 dark:border-slate-700 bg-gray-50/50 dark:bg-slate-900/50">
                  <Pagination
                      page={tenantPagination.page}
                      setPage={tenantPagination.setPage}
                      pageSize={tenantPagination.pageSize}
                      setPageSize={tenantPagination.setPageSize}
                      total={tenantPagination.total}
                      totalPages={tenantPagination.totalPages}
                      pageSizes={[5, 10, 25]}
                  />
              </div>
          )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
          {/* Generador de Script */}
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-200 bg-indigo-50/50 flex items-center">
                  <Terminal className="w-5 h-5 text-indigo-600 mr-2" />
                  <h3 className="text-lg font-bold text-indigo-900">Generador de Script (PowerShell)</h3>
              </div>
              <div className="p-6">
                  <div className="mb-4 p-4 bg-blue-50/50 border border-blue-100 rounded-lg flex items-start">
                      <ShieldCheck className="w-5 h-5 text-blue-600 mr-3 mt-0.5" />
                      <p className="text-sm text-blue-800">
                          {t('leastPrivilegeBanner', { tier: currentTier })}
                      </p>
                  </div>
                  <details className="mb-4 rounded-lg bg-amber-50 border border-amber-200 group">
                      <summary className="p-3 flex items-center gap-2 cursor-pointer text-sm font-bold text-amber-900 list-none select-none">
                          <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0" />
                          <span>{t('executorRolesTitle')}</span>
                          <ChevronDown className="w-4 h-4 ml-auto transition-transform group-open:rotate-180" />
                      </summary>
                      <div className="px-4 pb-4 pt-1 text-sm text-amber-900 space-y-2">
                          <p>{t('executorRolesIntro')}</p>
                          <ul className="list-disc pl-5 space-y-1">
                              <li>{t('executorRolesOwner')}</li>
                              <li>{t('executorRolesUaa')}</li>
                          </ul>
                          <p>{t('executorRolesGlobalAdmin')}</p>
                          <p className="text-xs text-amber-700">{t('executorRolesSummary')}</p>
                      </div>
                  </details>
                  <form onSubmit={generateScript} className="space-y-4">
                      <div>
                          <label className="block text-sm font-bold text-gray-700 mb-1">ID del Tenant del Cliente</label>
                          <input 
                              type="text" 
                              required
                              value={formTenantId}
                              onChange={(e) => setFormTenantId(e.target.value)}
                              className="border border-gray-300 dark:border-slate-700 dark:bg-slate-800 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 rounded px-3 py-2 w-full focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                              placeholder="Ej: d3cad9b1-57bf-4ff0-9064-..."
                          />
                      </div>
                      <div>
                          <label className="block text-sm font-bold text-gray-700 mb-1">ID de la Suscripción</label>
                          <input 
                              type="text" 
                              required
                              value={formSubscriptionId}
                              onChange={(e) => setFormSubscriptionId(e.target.value)}
                              className="border border-gray-300 dark:border-slate-700 dark:bg-slate-800 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 rounded px-3 py-2 w-full focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                              placeholder="Ej: 12345678-abcd-1234-..."
                          />
                          <p className="text-xs text-gray-500 mt-1">* Si necesitas agregar más de 1 suscripción, sepáralas por comas (ej: sub-1, sub-2).</p>
                      </div>
                      <button 
                          type="submit" 
                          disabled={generating}
                          className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2.5 rounded shadow transition-colors disabled:opacity-50"
                      >
                          {generating ? 'Generando...' : 'Generar Script de Onboarding'}
                      </button>
                  </form>
              </div>
          </div>

          {/* Resultado del Script */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl shadow-lg overflow-hidden flex flex-col">
              <div className="px-4 py-3 border-b border-gray-800 flex justify-between items-center bg-black/50">
                  <div className="flex items-center space-x-2">
                      <div className="w-3 h-3 rounded-full bg-red-500"></div>
                      <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
                      <div className="w-3 h-3 rounded-full bg-green-500"></div>
                      <span className="text-gray-400 text-xs font-mono ml-2">azure-cloud-shell.ps1</span>
                  </div>
                  {generatedScript && (
                      <button 
                          onClick={copyToClipboard}
                          className="text-gray-400 hover:text-white flex items-center text-xs font-bold transition-colors"
                      >
                          {copied ? <Check className="w-4 h-4 mr-1 text-green-500" /> : <Copy className="w-4 h-4 mr-1" />}
                          {copied ? 'Copiado' : 'Copiar al portapapeles'}
                      </button>
                  )}
              </div>
              <div className="p-4 flex-grow relative flex flex-col min-h-0">
                  {!generatedScript ? (
                      <div className="flex flex-col items-center justify-center h-full text-gray-600 min-h-[200px]">
                          <Terminal className="w-12 h-12 mb-2 opacity-20" />
                          <p className="text-sm">El script generado aparecerá aquí.</p>
                      </div>
                  ) : (
                      <>
                          <div className="text-xs text-indigo-300 mb-3 font-medium bg-indigo-900/30 p-2 rounded border border-indigo-800/50 flex-shrink-0">
                              ℹ️ Pida a su cliente que pegue este bloque en Azure Cloud Shell (Modo PowerShell).
                          </div>
                          <pre className="text-xs font-mono text-gray-300 overflow-x-auto whitespace-pre-wrap flex-1 min-h-0 overflow-y-auto custom-scrollbar">
                              <code>{generatedScript}</code>
                          </pre>
                      </>
                  )}
              </div>
          </div>
      </div>

      {/* Verificación de Permisos del Service Principal */}
      <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl shadow-sm overflow-hidden mb-8">
          <div className="px-6 py-4 border-b border-gray-200 dark:border-slate-800 bg-emerald-50/60 dark:bg-emerald-950/30 flex items-center">
              <ListChecks className="w-5 h-5 text-emerald-700 dark:text-emerald-400 mr-2" />
              <h3 className="text-lg font-bold text-emerald-900 dark:text-emerald-200">Verificar Permisos del Service Principal</h3>
          </div>
          <div className="p-6 space-y-4">
              <p className="text-sm text-gray-600 dark:text-gray-400">
                  Después de ejecutar el script de onboarding, validá que el Service Principal tenga todos los roles
                  requeridos según el tier contratado, en <strong>todas</strong> las suscripciones del tenant.
              </p>
              <div className="flex flex-col sm:flex-row gap-3">
                  <input
                      type="text"
                      value={checkTenantId}
                      onChange={e => setCheckTenantId(e.target.value)}
                      placeholder="Tenant ID a verificar"
                      className="flex-1 border border-gray-300 dark:border-slate-700 dark:bg-slate-800 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none font-mono"
                  />
                  <button
                      onClick={runCheckSpRoles}
                      disabled={checking || !checkTenantId}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-5 py-2 rounded shadow transition-colors disabled:opacity-50 flex items-center gap-2"
                  >
                      {checking ? <><Loader2 className="w-4 h-4 animate-spin" /> Verificando…</> : <><ListChecks className="w-4 h-4" /> Verificar Permisos</>}
                  </button>
              </div>

              {checkError && (
                  <div className="p-4 rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 text-sm text-red-800 dark:text-red-200 whitespace-pre-line">
                      <strong className="block mb-1">Error al verificar:</strong>
                      {checkError}
                  </div>
              )}

              {checkResult && (
                  <div className="space-y-4">
                      {/* Resumen */}
                      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                          <div className="p-3 rounded-lg bg-gray-100 dark:bg-slate-800 border border-gray-200 dark:border-slate-700">
                              <div className="text-xs text-gray-500 dark:text-gray-400 uppercase font-semibold">Tier</div>
                              <div className="text-lg font-bold text-gray-900 dark:text-white">{checkResult.summary.tier}</div>
                          </div>
                          <div className="p-3 rounded-lg bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900/60">
                              <div className="text-xs text-blue-700 dark:text-blue-300 uppercase font-semibold">Subs Total</div>
                              <div className="text-lg font-bold text-blue-900 dark:text-blue-200">{checkResult.summary.totalSubscriptions}</div>
                          </div>
                          <div className="p-3 rounded-lg bg-green-50 dark:bg-green-950/40 border border-green-200 dark:border-green-900/60">
                              <div className="text-xs text-green-700 dark:text-green-300 uppercase font-semibold">OK</div>
                              <div className="text-lg font-bold text-green-900 dark:text-green-200">{checkResult.summary.okCount}</div>
                          </div>
                          <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/60">
                              <div className="text-xs text-amber-700 dark:text-amber-300 uppercase font-semibold">Parcial</div>
                              <div className="text-lg font-bold text-amber-900 dark:text-amber-200">{checkResult.summary.partialCount}</div>
                          </div>
                          <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60">
                              <div className="text-xs text-red-700 dark:text-red-300 uppercase font-semibold">Sin Roles</div>
                              <div className="text-lg font-bold text-red-900 dark:text-red-200">{checkResult.summary.noRolesCount}</div>
                          </div>
                      </div>

                      {/* Roles requeridos */}
                      <div className="p-3 rounded-lg bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-900/60 text-xs">
                          <div className="font-semibold text-indigo-900 dark:text-indigo-200 mb-1">Roles requeridos para tier {checkResult.summary.tier}:</div>
                          <div className="flex flex-wrap gap-1">
                              {checkResult.summary.requiredRoles.map((r: string) => (
                                  <span key={r} className="px-2 py-0.5 rounded bg-indigo-100 dark:bg-indigo-900/60 text-indigo-900 dark:text-indigo-200 font-mono">{r}</span>
                              ))}
                              {checkResult.summary.requiredCustomRole && (
                                  <span className="px-2 py-0.5 rounded bg-purple-100 dark:bg-purple-900/60 text-purple-900 dark:text-purple-200 font-mono">{checkResult.summary.requiredCustomRole}</span>
                              )}
                          </div>
                          <div className="mt-2 text-indigo-700 dark:text-indigo-300">
                              SP ObjectId: <code className="font-mono">{checkResult.summary.spObjectId}</code>
                          </div>
                      </div>

                      {/* Hint global */}
                      {checkResult.globalHint && (
                          <div className={`p-3 rounded-lg border text-sm whitespace-pre-line ${
                              checkResult.summary.okCount === checkResult.summary.totalSubscriptions
                                  ? 'bg-green-50 dark:bg-green-950/40 border-green-200 dark:border-green-900/60 text-green-900 dark:text-green-200'
                                  : 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-900/60 text-amber-900 dark:text-amber-200'
                          }`}>
                              {checkResult.globalHint}
                          </div>
                      )}

                      {/* Tabla por suscripción */}
                      <div className="overflow-x-auto border border-gray-200 dark:border-slate-700 rounded-lg">
                          <table className="min-w-full divide-y divide-gray-200 dark:divide-slate-700 text-sm">
                              <thead className="bg-gray-50 dark:bg-slate-800">
                                  <tr>
                                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Estado</th>
                                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Suscripción</th>
                                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Roles Asignados</th>
                                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Faltantes</th>
                                  </tr>
                              </thead>
                              <tbody className="bg-white dark:bg-slate-900 divide-y divide-gray-200 dark:divide-slate-800">
                                  {checkResult.subscriptions.map((s: any) => (
                                      <tr key={s.subscriptionId}>
                                          <td className="px-4 py-3 align-top">{statusBadge(s.status)}</td>
                                          <td className="px-4 py-3 align-top">
                                              <div className="font-medium text-gray-900 dark:text-white">{s.displayName || '—'}</div>
                                              <div className="text-xs text-gray-500 dark:text-gray-400 font-mono">{s.subscriptionId}</div>
                                              {s.error && <div className="text-xs text-red-600 dark:text-red-400 mt-1">⚠ {s.error}</div>}
                                          </td>
                                          <td className="px-4 py-3 align-top">
                                              {s.assignedRoles.length === 0 ? (
                                                  <span className="text-xs text-gray-500 italic">Ninguno</span>
                                              ) : (
                                                  <div className="flex flex-wrap gap-1">
                                                      {s.assignedRoles.map((r: string) => (
                                                          <span key={r} className="px-2 py-0.5 rounded bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-300 text-xs font-mono">{r}</span>
                                                      ))}
                                                  </div>
                                              )}
                                              {s.customRoleRequired && s.customRoleName && (
                                                  <div className="mt-1 text-xs text-indigo-700 dark:text-indigo-300">
                                                      🛡️ Rol de remediación: <span className="font-mono font-semibold">{s.customRoleName}</span>
                                                  </div>
                                              )}
                                          </td>
                                          <td className="px-4 py-3 align-top">
                                              {s.missingRoles.length === 0 ? (
                                                  <span className="text-xs text-green-700 dark:text-green-400">— Completo</span>
                                              ) : (
                                                  <div className="flex flex-wrap gap-1">
                                                      {s.missingRoles.map((r: string) => (
                                                          <span key={r} className="px-2 py-0.5 rounded bg-red-100 dark:bg-red-900/40 text-red-800 dark:text-red-300 text-xs font-mono">{r}</span>
                                                      ))}
                                                  </div>
                                              )}
                                              {s.missingActions && s.missingActions.length > 0 && (
                                                  <div className="mt-1.5">
                                                      <div className="text-[11px] font-semibold text-red-700 dark:text-red-400 mb-0.5">Acciones faltantes:</div>
                                                      <div className="flex flex-wrap gap-1">
                                                          {s.missingActions.map((a: string) => (
                                                              <span key={a} className="px-1.5 py-0.5 rounded bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 text-[10px] font-mono border border-red-200 dark:border-red-900/60">{a}</span>
                                                          ))}
                                                      </div>
                                                  </div>
                                              )}
                                          </td>
                                      </tr>
                                  ))}
                              </tbody>
                          </table>
                      </div>

                      <p className="text-xs text-gray-500 dark:text-gray-400">
                          Verificado a las {new Date(checkResult.timestamp).toLocaleString()}
                      </p>
                  </div>
              )}
          </div>
      </div>

    </div>
  );
}
