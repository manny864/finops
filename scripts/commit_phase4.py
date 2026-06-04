import os
import subprocess
import sys

def main():
    base_dir = "/Users/manuelchavez/Documents/FinOpsProyect"
    
    print("--- Staging de archivos Fase 4 (Resource Graph & Multi-Sub) ---")
    try:
        subprocess.run(["git", "add", "."], cwd=base_dir, check=True)
        commit_msg = "feat: Phase 4 - Azure Resource Graph KQL, MSAL silent token auth, and Tenant-Wide multi-subscription support"
        print(f"Ejecutando: git commit -m '{commit_msg}'")
        
        result = subprocess.run(["git", "commit", "-m", commit_msg], cwd=base_dir)
        
        if result.returncode == 0:
            print("\nCommit generado exitosamente en la rama principal.")
        else:
            print(f"\nNo se pudo generar el commit o el arbol de trabajo está limpio (Código: {result.returncode}).")
            sys.exit(result.returncode)
            
    except subprocess.CalledProcessError as e:
        print(f"Error crítico durante el control de versiones: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
