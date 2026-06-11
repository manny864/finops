import os

def main():
    base_dir = "/Users/manuelchavez/Documents/FinOpsProyect"
    sop_path = os.path.join(base_dir, "directivas/git_push_SOP.md")
    
    with open(sop_path, "r", encoding="utf-8") as f:
        content = f.read()
    
    old_rule = "- El push requiere que la terminal tenga credenciales activas o GitHub CLI autenticado localmente. De lo contrario, fallará pidiendo permisos en la consola."
    new_rule = "- El push requiere que la terminal tenga credenciales activas o GitHub CLI autenticado localmente. De lo contrario, fallará pidiendo permisos en la consola.\n- **CRÍTICO**: Queda estrictamente prohibido realizar `git push` de forma automática. Los commits se deben guardar en local, y solo se debe hacer push cuando el usuario lo pida explícitamente en el chat."
    
    if old_rule in content and new_rule not in content:
        content = content.replace(old_rule, new_rule)
        with open(sop_path, "w", encoding="utf-8") as f:
            f.write(content)
        print("Updated git_push_SOP.md successfully.")
    else:
        print("SOP already up-to-date or match not found.")

if __name__ == "__main__":
    main()
