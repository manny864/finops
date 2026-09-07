import React from 'react';

export default function ApprovalWorkflowBoard() {
  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold text-gray-800">Cola de Remediación (Just-In-Time)</h2>
      
      {/* Kanban-style flex layout */}
      <div className="flex flex-col md:flex-row gap-4 items-start">
        
        {/* Pendiente de Aprobacion */}
        <div className="flex-1 bg-gray-50 rounded-lg p-4 border border-gray-200 w-full">
          <h3 className="text-sm font-bold text-gray-500 uppercase mb-4 flex items-center justify-between">
            Pendiente <span className="bg-gray-200 text-gray-700 px-2 py-0.5 rounded-full text-xs">2</span>
          </h3>
          <div className="flex flex-col gap-3">
            <div className="bg-white dark:bg-slate-900 p-4 rounded-md shadow-sm border-l-4 border-yellow-400 flex flex-col gap-3">
              <div>
                <h4 className="font-semibold text-sm text-gray-900">VM idle {`>`} 14 días</h4>
                <p className="text-xs text-gray-500 font-mono">vm-prod-analytics</p>
              </div>
              <div className="flex justify-between items-center mt-2 pt-2 border-t border-gray-100">
                <span className="text-sm font-bold text-green-600">Ahorro: $150</span>
                <button className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium px-3 py-1.5 rounded transition-colors">
                  Aprobar
                </button>
              </div>
            </div>
            <div className="bg-white dark:bg-slate-900 p-4 rounded-md shadow-sm border-l-4 border-yellow-400 flex flex-col gap-3">
              <div>
                <h4 className="font-semibold text-sm text-gray-900">Disco no asociado</h4>
                <p className="text-xs text-gray-500 font-mono">disk-backup-old</p>
              </div>
              <div className="flex justify-between items-center mt-2 pt-2 border-t border-gray-100">
                <span className="text-sm font-bold text-green-600">Ahorro: $40</span>
                <button className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium px-3 py-1.5 rounded transition-colors">
                  Aprobar
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* En Ejecucion */}
        <div className="flex-1 bg-gray-50 rounded-lg p-4 border border-gray-200 w-full opacity-70">
          <h3 className="text-sm font-bold text-gray-500 uppercase mb-4 flex items-center justify-between">
            En Ejecución <span className="bg-gray-200 text-gray-700 px-2 py-0.5 rounded-full text-xs">0</span>
          </h3>
          <div className="p-8 text-center text-sm text-gray-400 border-2 border-dashed border-gray-200 rounded-md">
            No hay tareas ejecutándose (Logic Apps)
          </div>
        </div>
        
      </div>
    </div>
  );
}
