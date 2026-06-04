import os
import subprocess
import sys

def main():
    base_dir = "/Users/manuelchavez/Documents/FinOpsProyect"
    remote_url = "https://github.com/manny864/finops.git"
    
    print(f"Configurando remoto 'origin' en {base_dir}...")
    
    try:
        # Prevent errors if origin somehow already exists
        subprocess.run(["git", "remote", "remove", "origin"], cwd=base_dir, stderr=subprocess.DEVNULL)
        
        print("Ejecutando: git remote add origin...")
        subprocess.run(["git", "remote", "add", "origin", remote_url], cwd=base_dir, check=True)
        
        print("Ejecutando: git branch -M main")
        subprocess.run(["git", "branch", "-M", "main"], cwd=base_dir, check=True)
        
        print("Ejecutando: git push -u origin main")
        # Let output stream directly
        result = subprocess.run(["git", "push", "-u", "origin", "main"], cwd=base_dir)
        
        if result.returncode == 0:
            print("\nPush a GitHub completado exitosamente.")
        else:
            print(f"\nFallo al realizar el git push. Código de salida: {result.returncode}")
            sys.exit(result.returncode)
            
    except subprocess.CalledProcessError as e:
        print(f"\nError durante configuración remota: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
