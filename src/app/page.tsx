import ZombieResourcesTable from "@/components/ZombieResourcesTable";

export default function Home() {
  return (
    <div className="flex flex-col gap-8 animate-in fade-in duration-500">
      <div className="flex justify-between items-end border-b border-gray-200 pb-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard General</h1>
          <p className="text-sm text-gray-500 mt-1">Visión global del rendimiento y eficiencia en la nube.</p>
        </div>
      </div>
      
      {/* Tabla de Recursos Zombie (Data Fetching Component) */}
      <section>
        <ZombieResourcesTable />
      </section>

      {/* Placeholders para reportes de Power BI (FinOps Toolkit) */}
      <section>
        <h2 className="text-xl font-bold text-gray-900 mb-4">Reportes de Costos (Power BI)</h2>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          <div className="bg-white border border-gray-200 rounded-lg shadow-sm h-72 flex items-center justify-center relative overflow-hidden group hover:shadow-md transition-shadow cursor-pointer">
            <div className="absolute inset-0 bg-blue-50/30 flex flex-col items-center justify-center gap-3">
              <span className="text-4xl opacity-40 group-hover:scale-110 transition-transform">📊</span>
              <h3 className="font-semibold text-gray-700 text-lg">Cost Summary</h3>
              <p className="text-xs text-gray-500 text-center px-6 leading-relaxed">
                Espacio reservado para embeber el reporte Power BI de <strong>Resumen de costos amortizados</strong>.
              </p>
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-lg shadow-sm h-72 flex items-center justify-center relative overflow-hidden group hover:shadow-md transition-shadow cursor-pointer">
            <div className="absolute inset-0 bg-blue-50/30 flex flex-col items-center justify-center gap-3">
              <span className="text-4xl opacity-40 group-hover:scale-110 transition-transform">📉</span>
              <h3 className="font-semibold text-gray-700 text-lg">Rate Optimization</h3>
              <p className="text-xs text-gray-500 text-center px-6 leading-relaxed">
                Espacio reservado para métricas de cobertura de <strong>Reservations</strong> y <strong>Savings Plans</strong>.
              </p>
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-lg shadow-sm h-72 flex items-center justify-center relative overflow-hidden group hover:shadow-md transition-shadow cursor-pointer">
            <div className="absolute inset-0 bg-blue-50/30 flex flex-col items-center justify-center gap-3">
              <span className="text-4xl opacity-40 group-hover:scale-110 transition-transform">⚡</span>
              <h3 className="font-semibold text-gray-700 text-lg">Workload Optimization</h3>
              <p className="text-xs text-gray-500 text-center px-6 leading-relaxed">
                Espacio reservado para reportes de <strong>Right-sizing</strong> y eficiencia computacional.
              </p>
            </div>
          </div>

        </div>
      </section>
    </div>
  );
}
