"use client";
import React, { useState, useEffect } from "react";

export default function OnboardingPage() {
  const [tenants, setTenants] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);

  const fetchTenants = async () => {
    setLoading(true);
    try {
        const res = await fetch('/api/tenants');
        const data = await res.json();
        if (data.tenants) {
            setTenants(data.tenants);
        }
    } catch(e) {}
    setLoading(false);
  };

  useEffect(() => {
    fetchTenants();
  }, []);

  const handleNameChange = (id: string, newName: string) => {
      setTenants(prev => prev.map(t => t.id === id ? { ...t, name: newName } : t));
  };

  const saveTenant = async (tenantId: string, newName: string) => {
      setSavingId(tenantId);
      try {
          const res = await fetch('/api/tenants', {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ tenantId, name: newName })
          });
          if (res.ok) {
              alert("Nombre del cliente actualizado con éxito. Refresca la página completa (F5) para actualizar el selector de Tenants superior.");
          } else {
              alert("Error al actualizar");
          }
      } catch (e) {
          alert("Error de red");
      }
      setSavingId(null);
  };

  return (
    <div className="max-w-6xl mx-auto p-6 animate-in fade-in duration-500">
      <div className="mb-8 border-b border-gray-200 pb-4">
        <h1 className="text-3xl font-extrabold text-gray-900 tracking-tight">Onboarding de Clientes</h1>
        <p className="text-gray-500 mt-2">Gestiona el inventario de Tenants conectados a la plataforma. Renombra los entornos para que sean legibles en el menú de navegación superior del SuperAdmin.</p>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 bg-gray-50/50">
            <h3 className="text-lg font-bold text-gray-800">Directorio de Entornos</h3>
        </div>
        
        {loading ? (
            <div className="p-10 text-center text-gray-400 animate-pulse">Cargando base de datos...</div>
        ) : (
            <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                        <tr>
                            <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Tenant ID (Azure)</th>
                            <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Nombre del Cliente / Dominio</th>
                            <th className="px-6 py-3 text-right text-xs font-bold text-gray-500 uppercase tracking-wider">Acciones</th>
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                        {tenants.map((t) => (
                            <tr key={t.id} className="hover:bg-gray-50 transition-colors">
                                <td className="px-6 py-4 whitespace-nowrap text-sm font-mono text-gray-500">{t.id}</td>
                                <td className="px-6 py-4 whitespace-nowrap">
                                    <input 
                                        type="text" 
                                        value={t.name}
                                        onChange={(e) => handleNameChange(t.id, e.target.value)}
                                        className="border border-gray-300 rounded px-3 py-1.5 text-sm w-full max-w-sm focus:ring-2 focus:ring-[#0054A6] focus:border-[#0054A6] transition-shadow"
                                        placeholder="Ej: Contoso Corp"
                                    />
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-right">
                                    <button
                                        onClick={() => saveTenant(t.id, t.name)}
                                        disabled={savingId === t.id}
                                        className="bg-[#0054A6] hover:bg-blue-800 text-white px-4 py-1.5 rounded-md text-xs font-bold shadow-sm transition-colors disabled:opacity-50"
                                    >
                                        {savingId === t.id ? 'Guardando...' : 'Guardar y Renombrar'}
                                    </button>
                                </td>
                            </tr>
                        ))}
                        {tenants.length === 0 && (
                            <tr>
                                <td colSpan={3} className="px-6 py-10 text-center text-sm text-gray-500">
                                    No hay tenants registrados en la base de datos MySQL aún.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        )}
      </div>
    </div>
  );
}
