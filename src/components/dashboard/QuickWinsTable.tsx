import React from 'react';
import Pagination, { usePagination } from '@/components/Pagination';

// Expected Data Interface
export interface QuickWin {
  id: string;
  resourceName: string;
  type: string;
  issue: string;
  potentialSavings: number;
}

export default function QuickWinsTable({ wins }: { wins: QuickWin[] }) {
  const { paged, ...paginationProps } = usePagination(wins, 10);
  
  return (
    <div className="bg-white shadow-sm rounded-lg overflow-hidden border border-gray-200">
      <div className="p-4 border-b border-gray-200">
        <h2 className="text-lg font-semibold text-gray-800">Top Quick Wins Detectables</h2>
      </div>
      
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-gray-50 text-gray-600 text-sm border-b border-gray-200">
              <th className="p-4 font-medium">Recurso</th>
              <th className="p-4 font-medium">Tipo</th>
              <th className="p-4 font-medium">Hallazgo</th>
              <th className="p-4 font-medium text-right">Ahorro Estimado</th>
            </tr>
          </thead>
          <tbody>
            {paged?.length ? paged.map((win) => (
              <tr 
                key={win.id} 
                className="border-b border-gray-100 hover:bg-gray-50 transition-colors"
                // Performance Optimization for Heavy Tables using content-visibility
                style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 50px' }}
              >
                <td className="p-4 text-sm font-medium text-blue-600">{win.resourceName}</td>
                <td className="p-4 text-sm text-gray-600">{win.type}</td>
                <td className="p-4 text-sm text-gray-600">
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                    {win.issue}
                  </span>
                </td>
                <td className="p-4 text-sm font-bold text-gray-900 text-right">${win.potentialSavings}/mo</td>
              </tr>
            )) : (
              <tr>
                <td colSpan={4} className="p-4 text-center text-sm text-gray-500">No hay Quick Wins detectados.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <Pagination {...paginationProps} />
    </div>
  );
}
