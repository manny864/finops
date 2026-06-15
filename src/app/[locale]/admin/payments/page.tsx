"use client";
import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';

export default function AdminPaymentsPage() {
  const [config, setConfig] = useState({
    LEMON_SQUEEZY_API_KEY: '',
    LEMON_SQUEEZY_STORE_ID: '',
    LEMON_SQUEEZY_PRO_VARIANT_ID: '',
    LEMON_SQUEEZY_BUSINESS_VARIANT_ID: '',
    LEMON_SQUEEZY_WEBHOOK_SECRET: ''
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch('/api/admin/payments')
      .then(res => res.json())
      .then(data => {
        if (data.success && data.config) {
          setConfig(data.config);
        }
      })
      .catch(err => toast.error("Error cargando configuración"))
      .finally(() => setLoading(false));
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setConfig({ ...config, [e.target.name]: e.target.value });
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch('/api/admin/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      });
      const data = await res.json();
      if (res.ok && data.success) {
        toast.success("Configuración de Pagos guardada.");
      } else {
        toast.error("Error guardando", { description: data.error });
      }
    } catch (err) {
      toast.error("Error de conexión");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="p-8 text-center text-gray-500">Cargando configuración...</div>;

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900 font-heading">Lemon Squeezy Configuration</h1>
        <p className="text-gray-500 mt-1">Configura las credenciales y IDs de los planes para la plataforma de pagos.</p>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="p-6 border-b border-gray-200 bg-gray-50">
          <h2 className="text-lg font-semibold text-gray-800">Credenciales de API</h2>
        </div>
        <form onSubmit={handleSave} className="p-6 space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">API Key</label>
            <input 
              type="password" 
              name="LEMON_SQUEEZY_API_KEY"
              value={config.LEMON_SQUEEZY_API_KEY} 
              onChange={handleChange}
              placeholder="eyJ0eX..."
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
            <p className="text-xs text-gray-500 mt-1">Token de acceso generado en Settings &gt; API.</p>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Store ID</label>
              <input 
                type="text" 
                name="LEMON_SQUEEZY_STORE_ID"
                value={config.LEMON_SQUEEZY_STORE_ID} 
                onChange={handleChange}
                placeholder="12345"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Webhook Secret</label>
              <input 
                type="password" 
                name="LEMON_SQUEEZY_WEBHOOK_SECRET"
                value={config.LEMON_SQUEEZY_WEBHOOK_SECRET} 
                onChange={handleChange}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              />
            </div>
          </div>

          <div className="border-t border-gray-200 pt-6 mt-6">
            <h3 className="text-md font-semibold text-gray-800 mb-4">Variant IDs (Planes)</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Professional Plan Variant ID</label>
                <input 
                  type="text" 
                  name="LEMON_SQUEEZY_PRO_VARIANT_ID"
                  value={config.LEMON_SQUEEZY_PRO_VARIANT_ID} 
                  onChange={handleChange}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Enterprise Plan Variant ID</label>
                <input 
                  type="text" 
                  name="LEMON_SQUEEZY_BUSINESS_VARIANT_ID"
                  value={config.LEMON_SQUEEZY_BUSINESS_VARIANT_ID} 
                  onChange={handleChange}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                />
              </div>
            </div>
          </div>

          <div className="flex justify-end pt-4">
            <button 
              type="submit" 
              disabled={saving}
              className={`px-6 py-2 rounded-lg font-medium text-white ${saving ? 'bg-blue-400' : 'bg-blue-600 hover:bg-blue-700'} transition-colors`}
            >
              {saving ? 'Guardando...' : 'Guardar Configuración'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
