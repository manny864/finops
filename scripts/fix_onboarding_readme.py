import os

def main():
    base_dir = "/Users/manuelchavez/Documents/FinOpsProyect"
    
    print("--- 1. Actualizando documentación ---")
    readme_path = os.path.join(base_dir, "README.md")
    readme_addition = """
## Arquitectura de Fase 3 (Base de Datos & MSAL Onboarding)
- **MySQL & Docker**: Implementación de base de datos local `finops_app` orquestada mediante Docker Compose y el pool de conexiones `mysql2`. Contiene las tablas de persistencia `Tenants` y `Users` entrelazadas por restricciones de clave foránea.
- **Zero-Trust JWT Isolation**: Endpoints backend altamente securizados que decodifican el Identity Token Bearer mediante `jsonwebtoken`. Verifican matemáticamente que el `tid` (Tenant ID) solicitado en la URL concuerde estrictamente con la firma criptográfica proveniente de Microsoft Entra ID.
- **Azure Key Vault**: Extracción dinámica de los secretos del cliente para instanciar el Service Principal multi-tenant de forma segura utilizando `@azure/keyvault-secrets`.
- **MSAL Autenticación y Registro**: Autenticación nativa integrada en Next.js App Router con `@azure/msal-react` (`loginRedirect`). Al retornar, intercepta el payload para enviar el `idToken` al endpoint local, el cual inserta a los nuevos Tenants atómicamente (`INSERT ON DUPLICATE KEY UPDATE`) en la base de datos MySQL.
"""
    with open(readme_path, "a") as f:
        f.write(readme_addition)
    print("README.md actualizado con las especificaciones técnicas completas de la Fase 3.")

    print("\n--- 2. Reparando flujo de Identidad (idToken) ---")
    auth_path = os.path.join(base_dir, "src", "components", "AuthProvider.tsx")
    with open(auth_path, "r") as f:
        auth_content = f.read()
    
    if "const accessToken = payload.accessToken;" in auth_content:
        auth_content = auth_content.replace(
            "const accessToken = payload.accessToken;",
            "const accessToken = payload.idToken; // FIX: Se envía el idToken para que el backend pueda extraer los claims 'tid' y 'oid'"
        )
        with open(auth_path, "w") as f:
            f.write(auth_content)
        print("Bug en AuthProvider.tsx reparado exitosamente.")
    else:
        print("La cadena 'payload.accessToken' no se encontró o ya había sido parchada.")

if __name__ == "__main__":
    main()
