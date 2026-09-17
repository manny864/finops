import os

base_dir = "/Users/manuelchavez/Documents/FinOpsProyect"

def deploy():
    print("Creando lib/onboardingScriptTemplate.ts...")
    lib_path = os.path.join(base_dir, "src/lib/onboardingScriptTemplate.ts")
    with open(lib_path, "w") as f:
        f.write("""export function generateOnboardingScript(clientTenantId: string, subscriptionId: string): string {
    return `# ==============================================================================
# CSCloudSolutions FinOps Agent - Onboarding Script (PowerShell / Azure Cloud Shell)
# ==============================================================================
# Execute este script en Azure Cloud Shell (Modo PowerShell).
#
# Objetivo: Crea un Service Principal con permisos de solo lectura para facturación
# e inventario, y un rol personalizado estrictamente limitado a 3 acciones para
# automatización y remediación (apagado/encendido y etiquetado).

$TenantId = "${clientTenantId}"
$SubscriptionId = "${subscriptionId}"
$AppName = "CSCloudSolutions-FinOps-Agent"
$RoleName = "CSCloudSolutions Remediation Role"

Write-Host "Seleccionando la suscripción $SubscriptionId..." -ForegroundColor Cyan
Set-AzContext -SubscriptionId $SubscriptionId

Write-Host "1. Creando la App Registration y el Service Principal..." -ForegroundColor Cyan
$sp = New-AzADServicePrincipal -DisplayName $AppName
$ClientId = $sp.AppId
$spId = $sp.Id

Write-Host "2. Generando Client Secret seguro..." -ForegroundColor Cyan
$secretParams = @{
    ObjectId = $sp.Id
    DisplayName = "FinOpsAutomationSecret"
    StartDate = (Get-Date)
    EndDate = (Get-Date).AddYears(2)
}
$secret = New-AzADAppCredential @secretParams
$ClientSecret = $secret.SecretText

Write-Host "3. Asignando Roles Incorporados (Reader & Cost Management Reader)..." -ForegroundColor Cyan
New-AzRoleAssignment -ObjectId $spId -RoleDefinitionName "Reader" -Scope "/subscriptions/$SubscriptionId"
New-AzRoleAssignment -ObjectId $spId -RoleDefinitionName "Cost Management Reader" -Scope "/subscriptions/$SubscriptionId"

Write-Host "3b. Asignando Cost Management Reader en el MANAGEMENT GROUP raiz (recomendado)..." -ForegroundColor Cyan
Write-Host "   Con este scope el costo de TODAS las suscripciones se consulta en UNA sola llamada." -ForegroundColor DarkGray
Write-Host "   Sin el, la plataforma consulta suscripcion por suscripcion y Cost Management responde 429." -ForegroundColor DarkGray
$TenantId = (Get-AzContext).Tenant.Id
try {
    New-AzRoleAssignment -ObjectId $spId -RoleDefinitionName "Cost Management Reader" -Scope "/providers/Microsoft.Management/managementGroups/$TenantId" -ErrorAction Stop | Out-Null
    Write-Host "   [OK] Asignado en el management group raiz." -ForegroundColor Green
} catch {
    Write-Host "   [FAIL] No se pudo asignar en el management group raiz: $($_.Exception.Message)" -ForegroundColor Yellow
    Write-Host "   Requiere ser Owner o User Access Administrator en el MG raiz. Pedirle a esa persona que ejecute:" -ForegroundColor Yellow
    Write-Host "   New-AzRoleAssignment -ObjectId $spId -RoleDefinitionName 'Cost Management Reader' -Scope '/providers/Microsoft.Management/managementGroups/$TenantId'" -ForegroundColor Yellow
}

Write-Host "4. Creando Rol Personalizado de Remediación Least-Privilege..." -ForegroundColor Cyan
$roleDef = Get-AzRoleDefinition -Name "Reader"
$roleDef.Id = $null
$roleDef.Name = $RoleName
$roleDef.Description = "Permite a CSCloudSolutions ejecutar acciones limitadas de FinOps (apagar, encender, etiquetar)"
$roleDef.Actions.Clear()
$roleDef.Actions.Add("Microsoft.Compute/virtualMachines/deallocate/action")
$roleDef.Actions.Add("Microsoft.Compute/virtualMachines/start/action")
$roleDef.Actions.Add("Microsoft.Resources/tags/write")
$roleDef.AssignableScopes.Clear()
$roleDef.AssignableScopes.Add("/subscriptions/$SubscriptionId")

$customRole = New-AzRoleDefinition -Role $roleDef
New-AzRoleAssignment -ObjectId $spId -RoleDefinitionName $RoleName -Scope "/subscriptions/$SubscriptionId"

Write-Host "==============================================================================" -ForegroundColor Green
Write-Host "¡Onboarding Completado con Éxito!" -ForegroundColor Green
Write-Host "Por favor, copie de forma segura el siguiente bloque JSON y envíelo a nuestro equipo:" -ForegroundColor Yellow

$output = @{
    TenantId = $TenantId
    SubscriptionId = $SubscriptionId
    ClientId = $ClientId
    ClientSecret = $ClientSecret
}

$output | ConvertTo-Json

Write-Host "Nota: El ClientSecret solo es visible una vez. Si lo pierde, deberá regenerarlo." -ForegroundColor Red
\`;
}
""")

    print("Creando API route POST...")
    api_dir = os.path.join(base_dir, "src/app/api/admin/onboarding")
    os.makedirs(api_dir, exist_ok=True)
    with open(os.path.join(api_dir, "route.ts"), "w") as f:
        f.write("""import { NextRequest, NextResponse } from "next/server";
import { generateOnboardingScript } from "@/lib/onboardingScriptTemplate";

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { clientTenantId, subscriptionId } = body;

        if (!clientTenantId || !subscriptionId) {
            return NextResponse.json({ error: "Faltan parámetros clientTenantId o subscriptionId" }, { status: 400 });
        }

        const script = generateOnboardingScript(clientTenantId, subscriptionId);
        
        return NextResponse.json({ success: true, script });
    } catch (e: any) {
        return NextResponse.json({ error: "Error interno del servidor", details: e.message }, { status: 500 });
    }
}
""")

    print("Actualizando page.tsx...")
    page_path = os.path.join(base_dir, "src/app/admin/onboarding/page.tsx")
    with open(page_path, "w") as f:
        f.write(""""use client";
import React, { useState, useEffect } from "react";
import { Terminal, Copy, Check, Server, ShieldCheck } from "lucide-react";

export default function OnboardingPage() {
  const [tenants, setTenants] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);

  // Generador State
  const [formTenantId, setFormTenantId] = useState("");
  const [formSubscriptionId, setFormSubscriptionId] = useState("");
  const [generatedScript, setGeneratedScript] = useState("");
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState(false);

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

  const handleNameChange = (id: string, newName: string) => {
      setTenants(prev => prev.map(t => t.id === id ? { ...t, name: newName } : t));
  };

  const saveTenant = async (tenantId: string, newName: string) => {
      setSavingId(tenantId);
      try {
          const res = await fetch('/api/tenants', {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ tenantId, name: newName })
          });
          if (res.ok) {
              alert("Nombre del cliente actualizado con éxito. Refresca la página completa (F5) para actualizar el selector superior.");
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

  return (
    <div className="max-w-6xl mx-auto p-6 animate-in fade-in duration-500">
      <div className="mb-8 border-b border-gray-200 pb-4">
        <h1 className="text-3xl font-extrabold text-gray-900 tracking-tight flex items-center">
            <ShieldCheck className="w-8 h-8 mr-3 text-indigo-600" />
            Onboarding de Clientes
        </h1>
        <p className="text-gray-500 mt-2">Genera scripts Least-Privilege de Azure y gestiona el inventario de Tenants conectados.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
          {/* Generador de Script */}
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-200 bg-indigo-50/50 flex items-center">
                  <Terminal className="w-5 h-5 text-indigo-600 mr-2" />
                  <h3 className="text-lg font-bold text-indigo-900">Generador de Script (PowerShell)</h3>
              </div>
              <div className="p-6">
                  <form onSubmit={generateScript} className="space-y-4">
                      <div>
                          <label className="block text-sm font-bold text-gray-700 mb-1">ID del Tenant del Cliente</label>
                          <input 
                              type="text" 
                              required
                              value={formTenantId}
                              onChange={(e) => setFormTenantId(e.target.value)}
                              className="border border-gray-300 rounded px-3 py-2 w-full focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
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
                              className="border border-gray-300 rounded px-3 py-2 w-full focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                              placeholder="Ej: 12345678-abcd-1234-..."
                          />
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

      <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden mt-8">
        <div className="px-6 py-4 border-b border-gray-200 bg-gray-50/50 flex items-center">
            <Server className="w-5 h-5 text-gray-500 mr-2" />
            <h3 className="text-lg font-bold text-gray-800">Directorio de Entornos</h3>
        </div>
        
        {loading ? (
            <div className="p-10 text-center text-gray-400 animate-pulse">Cargando base de datos...</div>
        ) : (
            <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                        <tr>
                            <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Tenant ID (Azure)</th>
                            <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Nombre del Cliente / Dominio</th>
                            <th className="px-6 py-3 text-right text-xs font-bold text-gray-500 uppercase tracking-wider">Acciones</th>
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                        {tenants.map((t) => (
                            <tr key={t.id} className="hover:bg-gray-50 transition-colors">
                                <td className="px-6 py-4 whitespace-nowrap text-sm font-mono text-gray-500">{t.id}</td>
                                <td className="px-6 py-4 whitespace-nowrap">
                                    <input 
                                        type="text" 
                                        value={t.name}
                                        onChange={(e) => handleNameChange(t.id, e.target.value)}
                                        className="border border-gray-300 rounded px-3 py-1.5 text-sm w-full max-w-sm focus:ring-2 focus:ring-[#0054A6] focus:border-[#0054A6] transition-shadow outline-none"
                                        placeholder="Ej: Contoso Corp"
                                    />
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-right">
                                    <button
                                        onClick={() => saveTenant(t.id, t.name)}
                                        disabled={savingId === t.id}
                                        className="bg-gray-800 hover:bg-black text-white px-4 py-1.5 rounded-md text-xs font-bold shadow-sm transition-colors disabled:opacity-50"
                                    >
                                        {savingId === t.id ? 'Guardando...' : 'Guardar y Renombrar'}
                                    </button>
                                </td>
                            </tr>
                        ))}
                        {tenants.length === 0 && (
                            <tr>
                                <td colSpan={3} className="px-6 py-10 text-center text-sm text-gray-500">
                                    No hay tenants registrados en la base de datos MySQL aún.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        )}
      </div>
    </div>
  );
}
""")

    print("Generando SOP...")
    sop_path = os.path.join(base_dir, "directivas/onboarding_SOP.md")
    os.makedirs(os.path.dirname(sop_path), exist_ok=True)
    with open(sop_path, "w") as f:
        f.write("# Onboarding Module SOP\\n\\n")
        f.write("- **Role-Based Access Control (RBAC)**: Se automatiza un principio de Privilegio Mínimo (Least Privilege). La aplicación usa los Roles Incorporados de Azure ('Reader', 'Cost Management Reader') combinados con un Rol Personalizado en el que solo se incluyen tres `Actions` de escritura.\\n")
        f.write("- **Experiencia Frontend (UX)**: El panel de PowerShell se renderiza usando Tailwind imitando una terminal nativa de macOS, permitiendo a los clientes confiar en la plataforma SaaS.\\n")
        f.write("- **Clipboard API**: Para evitar que los clientes corrompan el script al seleccionarlo manualmente con el mouse, el botón `navigator.clipboard.writeText` asegura la integridad del comando powershell.\\n")


if __name__ == "__main__":
    deploy()
    print("Onboarding Module Deploy completed.")
