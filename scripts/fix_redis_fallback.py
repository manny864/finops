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
    
    # 1. Inyectar función helper generateEmpty24hHistory
    search_helper = """function generateMockRedisHistory(seedOffset: number): MetricHistoryPoint[] {"""
    
    replace_helper = """function generateEmpty24hHistory(): MetricHistoryPoint[] {
    const points: MetricHistoryPoint[] = [];
    const now = new Date();
    for (let i = 23; i >= 0; i--) {
        const d = new Date(now.getTime() - i * 60 * 60 * 1000);
        const hours = d.getHours();
        const mins = d.getMinutes();
        const timestamp = `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
        points.push({
            timestamp,
            PercentProcessorTime: 0,
            ServerLoad: 0,
            UsedMemory: 0,
            CacheHits: 0,
            CacheMisses: 0,
            ConnectedClients: 0,
            OperationsPerSecond: 0,
            EvictedKeys: 0,
            ExpiredKeys: 0,
            Errors: 0,
            TotalCommandsProcessed: 0,
            CacheRead: 0,
            CacheWrite: 0
        });
    }
    return points;
}

function generateMockRedisHistory(seedOffset: number): MetricHistoryPoint[] {"""

    patch_file(api_path, search_helper, replace_helper)

    # 2. Inyectar el fallback para length === 0
    search_history = """                    const finalHistory = history;"""
    replace_history = """                    const finalHistory = history.length > 0 ? history : generateEmpty24hHistory();"""
    
    patch_file(api_path, search_history, replace_history)

    # 3. Inyectar el fallback en el catch
    search_catch = """                    return {
                        id: resource.id,
                        name: resource.name,
                        region: resource.location || "unknown",
                        sku: resource.skuName || "Unknown",
                        monthlyCostUsd,
                        history: []
                    };"""
                    
    replace_catch = """                    return {
                        id: resource.id,
                        name: resource.name,
                        region: resource.location || "unknown",
                        sku: resource.skuName || "Unknown",
                        monthlyCostUsd,
                        history: generateEmpty24hHistory()
                    };"""

    patch_file(api_path, search_catch, replace_catch)

    print("--- Parche de fallback de Redis completado ---")

if __name__ == "__main__":
    deploy()
