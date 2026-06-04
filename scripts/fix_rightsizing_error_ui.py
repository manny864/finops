import os

base_dir = "/Users/manuelchavez/Documents/FinOpsProyect"

def update_ui():
    path = os.path.join(base_dir, "src/app/intelligence/rightsizing/page.tsx")
    with open(path, "r") as f:
        content = f.read()
        
    old_error_ui = """      {error && (
        <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded-lg mb-6">
            <p className="text-red-700 font-bold">Error:</p>
            <p className="text-red-600 text-sm mt-1">{error}</p>
        </div>
      )}"""
      
    new_error_ui = """      {error && (
        <div className="bg-white border-l-4 border-amber-500 shadow-sm p-6 rounded-lg mb-6 flex items-start">
            <div className="flex-shrink-0">
                <AlertTriangle className="h-6 w-6 text-amber-500" />
            </div>
            <div className="ml-4">
                <h3 className="text-lg font-bold text-gray-900">Permisos de Resource Graph Restringidos</h3>
                <div className="mt-2 text-sm text-gray-600">
                    <p>Azure Resource Graph ha bloqueado la consulta de Máquinas Virtuales para la suscripción solicitada. Esto sucede comúnmente por dos razones:</p>
                    <ul className="list-disc pl-5 mt-2 space-y-1 text-gray-700">
                        <li>El Service Principal (Enterprise App) no tiene el rol de <strong>Reader</strong> (Lector) o <strong>Monitoring Reader</strong> asignado a nivel Suscripción.</li>
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
    path = os.path.join(base_dir, "directivas/rightsizing_SOP.md")
    if os.path.exists(path):
        with open(path, "a") as f:
            f.write("- **Error Handling**: Las consultas fallidas de Resource Graph (generalmente errores genéricos con correlationId) se capturan y renderizan como alertas de permisos de Azure RBAC en la UI.\\n")

if __name__ == "__main__":
    update_ui()
    update_sop()
    print("UI de Error Rightsizing mejorada desplegada.")
