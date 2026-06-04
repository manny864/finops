import os

base_dir = "/Users/manuelchavez/Documents/FinOpsProyect"

def update_ui():
    path = os.path.join(base_dir, "src/app/cleanup/ttl/page.tsx")
    with open(path, "r") as f:
        content = f.read()
        
    old_error_ui = """      {error && (
        <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded-lg mb-6 flex items-start">
            <AlertCircle className="w-6 h-6 text-red-500 mr-3 shrink-0" />
            <div>
                <p className="text-red-700 font-bold">Error de lectura:</p>
                <p className="text-red-600 text-sm mt-1">{error}</p>
            </div>
        </div>
      )}"""
      
    new_error_ui = """      {error && (
        <div className="bg-white border-l-4 border-amber-500 shadow-sm p-6 rounded-lg mb-6 flex items-start">
            <div className="flex-shrink-0">
                <AlertCircle className="h-6 w-6 text-amber-500" />
            </div>
            <div className="ml-4">
                <h3 className="text-lg font-bold text-gray-900">Permisos de Resource Graph Restringidos</h3>
                <div className="mt-2 text-sm text-gray-600">
                    <p>Azure Resource Graph ha bloqueado la lectura de entornos expirados. Esto sucede comúnmente por dos razones:</p>
                    <ul className="list-disc pl-5 mt-2 space-y-1 text-gray-700">
                        <li>El Service Principal (Enterprise App) no tiene el rol de <strong>Reader</strong> (Lector) en las suscripciones conectadas.</li>
                        <li>Las suscripciones configuradas para este Tenant no existen o han sido canceladas.</li>
                    </ul>
                    <div className="mt-4 p-3 bg-gray-50 rounded border border-gray-200 font-mono text-xs text-red-600 break-all">
                        <strong>Log técnico:</strong> {error}
                    </div>
                </div>
            </div>
        </div>
      )}"""
      
    if old_error_ui in content:
        content = content.replace(old_error_ui, new_error_ui)
        with open(path, "w") as f:
            f.write(content)
        print("UI de Error TTL reemplazada correctamente.")
    else:
        print("No se encontró el bloque exacto, revisa manualmente.")

def update_sop():
    path = os.path.join(base_dir, "directivas/ttl_enforcement_SOP.md")
    if os.path.exists(path):
        with open(path, "a") as f:
            f.write("- **Manejo de Errores de API**: Las excepciones de lectura de suscripciones devueltas por Azure con `correlationId` se remapean en UI hacia advertencias amistosas de RBAC para guiar al usuario a arreglar sus roles.\\n")

if __name__ == "__main__":
    update_ui()
    update_sop()
