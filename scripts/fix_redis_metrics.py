import os

base_dir = "/Users/manuelchavez/Documents/FinOpsProyect"

def patch_file(filepath, search_str, replace_str):
    print(f"Parcheando {filepath}...")
    with open(filepath, "r", encoding="utf-8") as f:
        content = f.read()
    if search_str not in content:
        print(f"Error: '{search_str}' no encontrado en {filepath}")
        return False
    content = content.replace(search_str, replace_str)
    with open(filepath, "w", encoding="utf-8") as f:
        f.write(content)
    print(f"Modificado exitosamente: {filepath}")
    return True

def deploy():
    api_path = os.path.join(base_dir, "src/app/api/intelligence/databases/redis-metrics/route.ts")
    
    # 1. Quitar TotalCommandsProcessed del array STANDARD_REDIS_METRICS
    search_metrics = """    "Errors",
    "TotalCommandsProcessed",
    "CacheRead","""
    
    replace_metrics = """    "Errors",
    "CacheRead","""
    
    patch_file(api_path, search_metrics, replace_metrics)

    # 2. Reemplazar la asignación por la estimación matemática
    search_assign = """                            totalCmds = getMetricValue("TotalCommandsProcessed");"""
    replace_assign = """                            totalCmds = Math.round(ops * 3600);"""
    
    patch_file(api_path, search_assign, replace_assign)
    
    print("--- Parche de corrección de Redis completado ---")

if __name__ == "__main__":
    deploy()
