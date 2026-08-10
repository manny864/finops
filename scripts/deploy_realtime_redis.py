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
    board_path = os.path.join(base_dir, "src/components/dashboard/RedisTestBoard.tsx")

    # 1. Actualizar helper de fallback para 60 minutos (por minuto) cuando es en tiempo real
    search_api_helper = """function generateEmpty24hHistory(): MetricHistoryPoint[] {
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
}"""

    replace_api_helper = """function generateEmpty24hHistory(isRealtime = false): MetricHistoryPoint[] {
    const points: MetricHistoryPoint[] = [];
    const now = new Date();
    const count = isRealtime ? 60 : 24;
    const stepMs = isRealtime ? 60 * 1000 : 60 * 60 * 1000;

    for (let i = count - 1; i >= 0; i--) {
        const d = new Date(now.getTime() - i * stepMs);
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
}"""

    patch_file(api_path, search_api_helper, replace_api_helper)

    # 2. Configurar la consulta de tiempo real con timespan=PT1H e interval=PT1M en route.ts
    search_api_cache = """        // Cache bust verification
        if (searchParams.get("bust") === "1") {
            await redis.del(cacheKey).catch(() => undefined);
        } else {
            const cached = await readDiagnosticsCache<unknown>(cacheKey);
            if (cached) return NextResponse.json(cached);
        }"""

    replace_api_cache = """        const isRealtime = searchParams.get("realtime") === "true" || searchParams.get("bust") === "1";

        // Bypass cache in realtime mode or when cache bust requested
        if (searchParams.get("bust") === "1") {
            await redis.del(cacheKey).catch(() => undefined);
        } else if (!isRealtime) {
            const cached = await readDiagnosticsCache<unknown>(cacheKey);
            if (cached) return NextResponse.json(cached);
        }"""

    patch_file(api_path, search_api_cache, replace_api_cache)

    # 3. Configurar timespan e interval dinámicos en route.ts
    search_api_metrics_url = """                    const metricNamesCsv = metricsToQuery.join(",");
                    
                    const metricsUrl = `https://management.azure.com${resource.id}/providers/Microsoft.Insights/metrics?api-version=2018-01-01&metricnames=${metricNamesCsv}&timespan=PT24H&interval=PT1H&aggregation=Average`;"""

    replace_api_metrics_url = """                    const metricNamesCsv = metricsToQuery.join(",");
                    const timespan = isRealtime ? "PT1H" : "PT24H";
                    const interval = isRealtime ? "PT1M" : "PT1H";
                    
                    const metricsUrl = `https://management.azure.com${resource.id}/providers/Microsoft.Insights/metrics?api-version=2018-01-01&metricnames=${metricNamesCsv}&timespan=${timespan}&interval=${interval}&aggregation=Average`;"""

    patch_file(api_path, search_api_metrics_url, replace_api_metrics_url)

    # 4. Actualizar llamadas a finalHistory y catch en route.ts
    search_final = """const finalHistory = history.length > 0 ? history : generateEmpty24hHistory();"""
    replace_final = """const finalHistory = history.length > 0 ? history : generateEmpty24hHistory(isRealtime);"""
    patch_file(api_path, search_final, replace_final)

    search_catch = """history: generateEmpty24hHistory()"""
    replace_catch = """history: generateEmpty24hHistory(isRealtime)"""
    patch_file(api_path, search_catch, replace_catch)

    # 5. Parchear RedisTestBoard.tsx para incluir el toggle de auto-refresh y el pulso Live Telemetry
    search_board_state = """    const [refreshing, setRefreshing] = useState(false);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);"""

    replace_board_state = """    const [refreshing, setRefreshing] = useState(false);
    const [autoRefresh, setAutoRefresh] = useState(true);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);"""

    patch_file(board_path, search_board_state, replace_board_state)

    search_board_fetch = """            const bustParam = bustCache ? '&bust=1' : '';
            const res = await fetch(`/api/intelligence/databases/redis-metrics?tenantId=${selectedTenant.id}${bustParam}`, { headers });"""

    replace_board_fetch = """            const queryParams = `?tenantId=${selectedTenant.id}&realtime=true${bustCache ? '&bust=1' : ''}`;
            const res = await fetch(`/api/intelligence/databases/redis-metrics${queryParams}`, { headers });"""

    patch_file(board_path, search_board_fetch, replace_board_fetch)

    search_board_effect = """    useEffect(() => {
        fetchMetrics();
    }, [selectedTenant?.id, msalAccounts.length]);"""

    replace_board_effect = """    useEffect(() => {
        fetchMetrics(true);

        let intervalId: NodeJS.Timeout | null = null;
        if (autoRefresh) {
            intervalId = setInterval(() => {
                fetchMetrics(true);
            }, 30000);
        }

        return () => {
            if (intervalId) clearInterval(intervalId);
        };
    }, [selectedTenant?.id, msalAccounts.length, autoRefresh]);"""

    patch_file(board_path, search_board_effect, replace_board_effect)

    # 6. Agregar botón e insignia de Tiempo Real en la cabecera del RedisTestBoard
    search_board_header_btn = """                <button
                    onClick={() => fetchMetrics(true)}
                    disabled={refreshing}
                    className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-lg transition-colors shadow-sm disabled:opacity-50"
                >
                    <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
                    Actualizar
                </button>"""

    replace_board_header_btn = """                <div className="flex items-center gap-2">
                    <button
                        onClick={() => setAutoRefresh(!autoRefresh)}
                        className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-semibold transition-all ${
                            autoRefresh
                                ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800 shadow-sm'
                                : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 border-slate-200 dark:border-slate-700'
                        }`}
                        title="Modo Tiempo Real (Auto-refresco cada 30 segundos)"
                    >
                        <span className={`w-2 h-2 rounded-full ${autoRefresh ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'}`} />
                        <span>{autoRefresh ? 'Tiempo Real (30s)' : 'Tiempo Real Pausado'}</span>
                    </button>
                    <button
                        onClick={() => fetchMetrics(true)}
                        disabled={refreshing}
                        className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-lg transition-colors shadow-sm disabled:opacity-50"
                    >
                        <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
                        Actualizar
                    </button>
                </div>"""

    patch_file(board_path, search_board_header_btn, replace_board_header_btn)

    print("--- Despliegue de Tiempo Real para Redis completado exitosamente ---")

if __name__ == "__main__":
    deploy()
