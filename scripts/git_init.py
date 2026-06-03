import os
import subprocess
import sys

def main():
    base_dir = "/Users/manuelchavez/Documents/FinOpsProyect"
    print(f"Iniciando configuración de Git en {base_dir}...")
    
    try:
        # 1. git init
        print("Ejecutando: git init")
        subprocess.run(["git", "init"], cwd=base_dir, check=True)
        
        # 2. git add .
        print("Ejecutando: git add .")
        subprocess.run(["git", "add", "."], cwd=base_dir, check=True)
        
        # 3. git commit
        commit_msg = "Initial Next.js and Docker architecture setup"
        print(f'Ejecutando: git commit -m "{commit_msg}"')
        subprocess.run(["git", "commit", "-m", commit_msg], cwd=base_dir, check=True)
        
        print("\nCommit creado exitosamente.")
    except subprocess.CalledProcessError as e:
        print(f"\nError al ejecutar comando de git: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
