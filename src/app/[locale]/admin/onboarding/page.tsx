"use client";
import React, { useState, useEffect } from "react";
import { Terminal, Copy, Check, Server, ShieldCheck, Database } from "lucide-react";
import { useTenant } from '@/components/TenantProvider';
import { useTranslations } from "next-intl";

export default function OnboardingPage() {
  const t = useTranslations('onboarding');
  const { selectedTenant, systemRole } = useTenant();
  const [tenants, setTenants] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);

  // Generador State
  const [formTenantId, setFormTenantId] = useState("");
  const [formSubscriptionId, setFormSubscriptionId] = useState("");
  const [generatedScript, setGeneratedScript] = useState("");
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState(false);

  // Set the default form tenant ID when the page loads
  useEffect(() => {
      if (selectedTenant && selectedTenant.id !== 'default') {
          setFormTenantId(selectedTenant.id);
      }
  }, [selectedTenant]);

  const fetchTenants = async () => {
    setLoading(true);
    try {
        const res = await fetch('/api/tenants');
        const data = await res.json();
        if (data.tenants) {
            setTenants(data.tenants);
        }
    } catch(e) {}
    setLoading(false);
  };

  useEffect(() => {
    fetchTenants();
  }, []);

  const handleNameChange = (id: string, field: string, value: string) => {
      setTenants(prev => prev.map(t => t.id === id ? { ...t, [field]: value } : t));
  };

  const saveTenant = async (tenantId: string, newName: string, clientId?: string, clientSecret?: string) => {
      setSavingId(tenantId);
      try {
          const res = await fetch('/api/tenants', {
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
      setGenerating(true);
      try {
          const res = await fetch('/api/admin/onboarding', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ clientTenantId: formTenantId, subscriptionId: formSubscriptionId })
          });
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

  const isSuperAdmin = systemRole === 'SUPERADMIN';
  const [adminFilterId, setAdminFilterId] = useState<string>("all");

  const displayedTenants = isSuperAdmin 
      ? (adminFilterId === "all" ? tenants : tenants.filter(t => t.id === adminFilterId))
      : tenants.filter(t => t.id === selectedTenant.id);

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
                  <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Filtrar Tenant:</span>
                      <select 
                          value={adminFilterId}
                          onChange={(e) => setAdminFilterId(e.target.value)}
                          className="border border-gray-300 dark:border-slate-700 dark:bg-slate-800 dark:text-white rounded-md px-3 py-1.5 text-sm focus:ring-indigo-500 focus:border-indigo-500"
                      >
                          <option value="all" className="bg-white dark:bg-slate-800 text-gray-900 dark:text-white">Todos los entornos</option>
                          {tenants.map(t => (
                              <option key={t.id} value={t.id} className="bg-white dark:bg-slate-800 text-gray-900 dark:text-white">{t.name || 'Sin Nombre'} ({t.id.substring(0,8)}...)</option>
                          ))}
                      </select>
                  </div>
              )}
          </div>
          <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-slate-700">
                  <thead className="bg-gray-50 dark:bg-slate-800">
                      <tr>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Tenant ID (Azure)</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Nombre del Cliente / Dominio</th>
                          <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Acciones</th>
                      </tr>
                  </thead>
                  <tbody className="bg-white dark:bg-slate-800 divide-y divide-gray-200 dark:divide-slate-700">
                      {displayedTenants.map((tenant) => (
                          <tr key={tenant.id} className="hover:bg-gray-50 transition-colors">
                              <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-500 font-mono">
                                  {tenant.id}
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap">
                                  <div className="flex flex-col space-y-2">
                                      <input 
                                          type="text" 
                                          value={tenant.name} 
                                          onChange={(e) => handleNameChange(tenant.id, 'name', e.target.value)}
                                          className="border border-gray-300 dark:border-slate-700 dark:bg-slate-800 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 rounded px-2 py-1 text-sm focus:ring-indigo-500 focus:border-indigo-500 w-full md:w-64"
                                      />
                                      <div className="flex space-x-2">
                                          <input 
                                              type="text" 
                                              placeholder="Client ID"
                                              value={tenant.client_id || ''} 
                                              onChange={(e) => handleNameChange(tenant.id, 'client_id', e.target.value)}
                                              className="border border-gray-300 dark:border-slate-700 dark:bg-slate-800 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 rounded px-2 py-1 text-sm focus:ring-indigo-500 focus:border-indigo-500 w-32 md:w-48"
                                          />
                                          <input 
                                              type="password" 
                                              placeholder="Client Secret"
                                              value={tenant.client_secret || ''} 
                                              onChange={(e) => handleNameChange(tenant.id, 'client_secret', e.target.value)}
                                              className="border border-gray-300 dark:border-slate-700 dark:bg-slate-800 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 rounded px-2 py-1 text-sm focus:ring-indigo-500 focus:border-indigo-500 w-32 md:w-48"
                                          />
                                      </div>
                                  </div>
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                  <button 
                                      onClick={() => saveTenant(tenant.id, tenant.name, tenant.client_id, tenant.client_secret)}
                                      disabled={savingId === tenant.id}
                                      className="bg-gray-900 text-white px-4 py-2 rounded-md hover:bg-gray-800 transition-colors disabled:opacity-50"
                                  >
                                      {savingId === tenant.id ? 'Guardando...' : 'Guardar'}
                                  </button>
                              </td>
                          </tr>
                      ))}
                      {displayedTenants.length === 0 && !loading && (
                          <tr>
                              <td colSpan={3} className="px-6 py-4 text-center text-sm text-gray-500">
                                  El entorno no está sincronizado con la base de datos.
                              </td>
                          </tr>
                      )}
                  </tbody>
              </table>
          </div>
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
              <div className="p-4 flex-grow relative">
                  {!generatedScript ? (
                      <div className="flex flex-col items-center justify-center h-full text-gray-600 min-h-[200px]">
                          <Terminal className="w-12 h-12 mb-2 opacity-20" />
                          <p className="text-sm">El script generado aparecerá aquí.</p>
                      </div>
                  ) : (
                      <>
                          <div className="text-xs text-indigo-300 mb-3 font-medium bg-indigo-900/30 p-2 rounded border border-indigo-800/50">
                              ℹ️ Pida a su cliente que pegue este bloque en Azure Cloud Shell (Modo PowerShell).
                          </div>
                          <pre className="text-xs font-mono text-gray-300 overflow-x-auto whitespace-pre-wrap max-h-[300px] overflow-y-auto custom-scrollbar">
                              <code>{generatedScript}</code>
                          </pre>
                      </>
                  )}
              </div>
          </div>
      </div>

    </div>
  );
}
