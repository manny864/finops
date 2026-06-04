import os
import subprocess
import sys

def main():
    base_dir = "/Users/manuelchavez/Documents/FinOpsProyect"
    
    print("--- 1. Generando README.md corporativo ---")
    readme_path = os.path.join(base_dir, "README.md")
    readme_content = """# FinOps Azure App - CSCloudSolutions

Esta aplicación es un MVP (Minimum Viable Product) multi-tenant diseñado para el análisis, la detección de oportunidades de ahorro y la remediación automatizada de costos en Microsoft Azure.

## Arquitectura de Fase 1 (Base Operativa)
- **Framework Core:** Next.js 16.x (App Router) con soporte híbrido de Server/Client Components.
- **Motor Backend Azure:** Endpoints REST robustos utilizando `@azure/identity`, `@azure/arm-compute`, y `@azure/arm-network` para detectar recursos zombies en la nube (Discos desasociados e IPs no asignadas).
- **Frontend Interactivo:** Estilizado mediante Tailwind CSS v4, inyectando la identidad corporativa de CSCloudSolutions. Cuenta con un layout dinámico SPA, mockups de autenticación listos para MSAL (Entra ID) y vistas reservadas para iFrames de Power BI.
- **Contenerización:** Configuración `standalone` y `Dockerfile` multi-stage preparados para un despliegue optimizado.

## Instalación y Ejecución
1. Instalar dependencias: `npm install`
2. Ejecutar entorno local: `npm run dev`

*Arquitectura estructurada de forma autónoma siguiendo directivas deterministas.*
"""
    with open(readme_path, "w") as f:
        f.write(readme_content)

    print("--- 2. Ejecutando Git Staging y Commit ---")
    try:
        subprocess.run(["git", "add", "."], cwd=base_dir, check=True)
        commit_msg = "feat: Complete Phase 1 base architecture, backend Azure APIs, and Frontend SPA layout"
        print(f"Ejecutando: git commit -m '{commit_msg}'")
        # Let output stream to user
        result = subprocess.run(["git", "commit", "-m", commit_msg], cwd=base_dir)
        
        if result.returncode == 0:
            print("\nCommit generado exitosamente en la rama actual.")
        else:
            print(f"\nNo se detectaron cambios para commitear o hubo un error (Salida: {result.returncode}).")
            sys.exit(result.returncode)
            
    except subprocess.CalledProcessError as e:
        print(f"Error crítico durante el control de versiones: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
