import os

base_dir = "/Users/manuelchavez/Documents/FinOpsProyect"

def update_ui():
    path = os.path.join(base_dir, "src/app/intelligence/billing/page.tsx")
    with open(path, "r") as f:
        content = f.read()
        
    old_error_ui = """      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-lg mb-6">
            Error: {error}. Revise que el entorno tenga permisos de lectura en Cost Management.
        </div>
      )}"""
      
    new_error_ui = """      {error && (
        <div className="bg-white border-l-4 border-amber-500 shadow-sm p-6 rounded-lg mb-6 flex items-start">
            <div className="flex-shrink-0">
                <svg className="h-6 w-6 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
            </div>
            <div className="ml-4">
                <h3 className="text-lg font-bold text-gray-900">Permisos de Cost Management Restringidos</h3>
                <div className="mt-2 text-sm text-gray-600">
                    <p>Azure Cost Management ha bloqueado la lectura de costos para la suscripción solicitada. Esto sucede comúnmente por dos razones:</p>
                    <ul className="list-disc pl-5 mt-2 space-y-1 text-gray-700">
                        <li>El Service Principal (Enterprise App) no tiene el rol de <strong>Cost Management Reader</strong> asignado a nivel Suscripción.</li>
                        <li>La suscripción proporcionada no existe en este Tenant o ha sido cancelada.</li>
                    </ul>
                    <div className="mt-4 p-3 bg-gray-50 rounded border border-gray-200 font-mono text-xs text-red-600 break-all">
                        <strong>Log técnico:</strong> {error}
                    </div>
                </div>
            </div>
        </div>
      )}"""
      
    content = content.replace(old_error_ui, new_error_ui)
    
    with open(path, "w") as f:
        f.write(content)

def update_sop():
    path = os.path.join(base_dir, "directivas/billing_module_SOP.md")
    with open(path, "a") as f:
        f.write("- **Error Handling**: Las faltas de permisos (`SubscriptionNotFound` o `AuthorizationFailed`) se controlan mediante alertas de interfaz (UI) orientando al usuario a arreglar su RBAC en lugar de pintar errores crudos.\\n")

if __name__ == "__main__":
    update_ui()
    update_sop()
    print("UI de Error mejorada desplegada.")
