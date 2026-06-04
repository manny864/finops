import os

def main():
    base_dir = "/Users/manuelchavez/Documents/FinOpsProyect"
    print("--- Fase 6: Inyección de Banner RBAC Automático ---")

    # 1. Crear SOP
    sop_path = os.path.join(base_dir, "directivas", "rbac_onboarding_SOP.md")
    sop_content = """# Directiva: Onboarding RBAC Cero-Fricción

## Objetivo
Detectar cuando la aplicación ha sido consentida (Admin Consent) pero carece de permisos sobre los recursos (Suscripciones / Resource Graph), y proporcionar una experiencia automatizada al cliente.

## Lógica
- Si la API de Azure devuelve un error 403 (AccessDenied) o `AuthorizationFailed`, el backend interceptará este error y devolverá un HTTP 403 con el código `MISSING_RBAC_ROLE`.
- El Frontend (React) atrapará este código y renderizará `<RoleAssignmentBanner />` en lugar de una tabla vacía o un error genérico.
- El Banner proporciona el script `az role assignment create` usando el Client ID nativo, permitiendo al cliente ejecutarlo directamente en Cloud Shell.
"""
    with open(sop_path, "w") as f:
        f.write(sop_content)

    # 2. Modificar subscriptions/route.ts para interceptar AccessDenied
    sub_route = os.path.join(base_dir, "src", "app", "api", "subscriptions", "route.ts")
    with open(sub_route, "r") as f:
        sub_code = f.read()
    
    sub_code = sub_code.replace(
        'return NextResponse.json({ error: "Error obteniendo suscripciones", details: error.message }, { status: 500 });',
        'if (error.code === "AccessDenied" || error.statusCode === 403 || error.message.includes("AccessDenied") || error.message.includes("AuthorizationFailed")) {\n      return NextResponse.json({ error: "MISSING_RBAC_ROLE", details: "La aplicación no tiene permisos de Lector en las suscripciones." }, { status: 403 });\n    }\n    return NextResponse.json({ error: "Error obteniendo suscripciones", details: error.message }, { status: 500 });'
    )
    with open(sub_route, "w") as f:
        f.write(sub_code)

    # 3. Modificar recommendations/route.ts para interceptar AccessDenied
    rec_route = os.path.join(base_dir, "src", "app", "api", "recommendations", "route.ts")
    with open(rec_route, "r") as f:
        rec_code = f.read()
    
    rec_code = rec_code.replace(
        'return NextResponse.json({ error: "Error en SDK o Resource Graph", details: error.message }, { status: 500 });',
        'if (error.code === "AccessDenied" || error.statusCode === 403 || error.message.includes("AccessDenied") || error.message.includes("AuthorizationFailed")) {\n      return NextResponse.json({ error: "MISSING_RBAC_ROLE", details: "La aplicación no tiene permisos de Lector." }, { status: 403 });\n    }\n    return NextResponse.json({ error: "Error en SDK o Resource Graph", details: error.message }, { status: 500 });'
    )
    with open(rec_route, "w") as f:
        f.write(rec_code)

    # 4. Crear RoleAssignmentBanner.tsx
    banner_path = os.path.join(base_dir, "src", "components", "RoleAssignmentBanner.tsx")
    banner_code = """'use client';
import React, { useState } from 'react';

export default function RoleAssignmentBanner() {
    const [copied, setCopied] = useState(false);
    const clientId = process.env.NEXT_PUBLIC_CLIENT_ID || "876d8a5b-6023-4484-b3ba-73c186e4a72b";
    
    // Script automatizado que resuelve el Object ID a traves del Client ID y usa la sub actual.
    const cliCommand = `az role assignment create --assignee "${clientId}" --role "Reader" --scope "/subscriptions/$(az account show --query id -o tsv)"`;

    const handleCopy = () => {
        navigator.clipboard.writeText(cliCommand);
        setCopied(true);
        setTimeout(() => setCopied(false), 3000);
    };

    return (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 my-8 mx-4 shadow-sm">
            <div className="flex items-start">
                <div className="flex-shrink-0">
                    <svg className="h-6 w-6 text-blue-600 mt-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                </div>
                <div className="ml-4 w-full">
                    <h3 className="text-lg font-bold text-blue-900">Permiso de Lectura Requerido</h3>
                    <div className="mt-2 text-sm text-blue-800">
                        <p>Tu cuenta ha sido vinculada exitosamente, pero nuestra plataforma requiere permisos de Lector en tu Suscripción de Azure para detectar los recursos zombis y optimizar tus costos.</p>
                        <p className="mt-3 font-semibold">Ejecuta este comando seguro en tu consola de Azure para habilitarlo:</p>
                    </div>
                    
                    <div className="mt-4 relative">
                        <div className="bg-gray-900 rounded-md p-4 overflow-x-auto">
                            <code className="text-green-400 font-mono text-sm whitespace-pre">{cliCommand}</code>
                        </div>
                        <button 
                            onClick={handleCopy}
                            className="absolute top-2 right-2 bg-gray-700 hover:bg-gray-600 text-white text-xs px-3 py-1.5 rounded transition-colors"
                        >
                            {copied ? "¡Copiado!" : "Copiar"}
                        </button>
                    </div>
                    
                    <div className="mt-5 flex space-x-4">
                        <a 
                            href="https://portal.azure.com/#cloudshell/"
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                        >
                            Abrir Azure Cloud Shell
                            <svg className="ml-2 -mr-1 h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
                                <path d="M11 3a1 1 0 100 2h2.586l-6.293 6.293a1 1 0 101.414 1.414L15 6.414V9a1 1 0 102 0V4a1 1 0 00-1-1h-5z" />
                                <path d="M5 5a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2v-3a1 1 0 10-2 0v3H5V7h3a1 1 0 000-2H5z" />
                            </svg>
                        </a>
                    </div>
                </div>
            </div>
        </div>
    );
}
"""
    with open(banner_path, "w") as f:
        f.write(banner_code)

    # 5. Integrar el Banner en ZombieResourcesTable.tsx
    table_path = os.path.join(base_dir, "src", "components", "ZombieResourcesTable.tsx")
    with open(table_path, "r") as f:
        table_code = f.read()

    # Importar el banner en la parte superior
    table_code = table_code.replace(
        "import { useMsal } from '@azure/msal-react';",
        "import { useMsal } from '@azure/msal-react';\nimport RoleAssignmentBanner from './RoleAssignmentBanner';"
    )

    # Actualizar la detección de errores (MISSING_RBAC_ROLE)
    table_code = table_code.replace(
        "setError(json.error || \"Error de servidor al consultar recursos.\");",
        "setError(json.error === 'MISSING_RBAC_ROLE' ? 'MISSING_RBAC_ROLE' : (json.error || \"Error de servidor al consultar recursos.\"));"
    )

    # Actualizar el renderizado del error
    table_code = table_code.replace(
        "{error && <span className=\"mt-2 inline-block text-xs text-amber-600 bg-amber-50 px-2 py-1 rounded border border-amber-200\">{error}</span>}",
        "{error && error !== 'MISSING_RBAC_ROLE' && <span className=\"mt-2 inline-block text-xs text-amber-600 bg-amber-50 px-2 py-1 rounded border border-amber-200\">{error}</span>}"
    )

    table_code = table_code.replace(
        "{loading ? (",
        "{error === 'MISSING_RBAC_ROLE' ? <RoleAssignmentBanner /> : loading ? ("
    )
    
    # Cerrar el div del banner (necesitamos añadir una llave de cierre extra para el operador ternario)
    # Reemplazaremos el ultimo `)}` correspondiente a loading con un doble cierre.
    # Es más seguro usar RegExp o reemplazo exacto del final de JSX
    table_code = table_code.replace(
        "      )}\n    </div>\n  );\n}",
        "      ) : null}\n    </div>\n  );\n}"
    )

    with open(table_path, "w") as f:
        f.write(table_code)

    print("Script completado exitosamente.")

if __name__ == "__main__":
    main()
