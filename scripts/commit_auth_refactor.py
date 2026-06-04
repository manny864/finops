import os
import subprocess
import sys

def main():
    base_dir = "/Users/manuelchavez/Documents/FinOpsProyect"
    
    print("--- Staging de archivos Multi-Tenant ---")
    try:
        subprocess.run(["git", "add", "."], cwd=base_dir, check=True)
        commit_msg = "refactor: Migrate Azure authentication to multi-tenant ClientSecretCredential model"
        print(f"Ejecutando: git commit -m '{commit_msg}'")
        
        # Permitimos ver la salida directamente
        result = subprocess.run(["git", "commit", "-m", commit_msg], cwd=base_dir)
        
        if result.returncode == 0:
            print("\nCommit de arquitectura de seguridad generado exitosamente.")
        else:
            print(f"\nAdvertencia: No se pudo generar el commit o el working tree estaba limpio (Código: {result.returncode}).")
            sys.exit(result.returncode)
            
    except subprocess.CalledProcessError as e:
        print(f"Error crítico durante el control de versiones: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
