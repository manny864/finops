"use client";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Monitor, Moon, Sun, Settings } from "lucide-react";
import { useTenant } from '@/components/TenantProvider';
import { useMsal } from '@azure/msal-react';
import { toast } from 'sonner';

import DeleteTenantModal from '@/components/DeleteTenantModal';

export default function ConfigPage() {
  const { theme, setTheme } = useTheme();
  const { selectedTenant } = useTenant();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  return (
    <div className="p-6 max-w-4xl mx-auto animate-in fade-in duration-500">
      <div className="mb-8 border-b border-gray-200 dark:border-gray-800 pb-4">
        <h1 className="text-3xl font-extrabold text-gray-900 dark:text-white tracking-tight flex items-center">
            <Settings className="w-8 h-8 mr-3 text-[#0054A6] dark:text-[#00AEEF]" />
            Configuración Global
        </h1>
        <p className="text-gray-500 dark:text-gray-400 mt-2">Personaliza la apariencia y el comportamiento de la plataforma FinOps.</p>
      </div>

      <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl shadow-sm overflow-hidden mb-8">
        <div className="px-6 py-4 border-b border-gray-200 dark:border-slate-800 bg-gray-50/50 dark:bg-slate-900/50">
            <h3 className="text-lg font-bold text-gray-800 dark:text-gray-100">Apariencia</h3>
        </div>
        <div className="p-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between">
                <div>
                    <h4 className="font-semibold text-gray-900 dark:text-white">Tema de la Interfaz</h4>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Selecciona cómo deseas visualizar la plataforma.</p>
                </div>
                
                <div className="mt-4 md:mt-0 flex p-1 bg-gray-100 dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700">
                    <button
                        onClick={() => setTheme('light')}
                        className={`flex items-center px-4 py-2 text-sm font-semibold rounded-md transition-all ${theme === 'light' ? 'bg-white dark:bg-slate-700 shadow-sm text-[#0054A6] dark:text-[#00AEEF]' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'}`}
                    >
                        <Sun className="w-4 h-4 mr-2" />
                        Claro
                    </button>
                    <button
                        onClick={() => setTheme('dark')}
                        className={`flex items-center px-4 py-2 text-sm font-semibold rounded-md transition-all ${theme === 'dark' ? 'bg-white dark:bg-slate-700 shadow-sm text-[#0054A6] dark:text-[#00AEEF]' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'}`}
                    >
                        <Moon className="w-4 h-4 mr-2" />
                        Oscuro
                    </button>
                    <button
                        onClick={() => setTheme('system')}
                        className={`flex items-center px-4 py-2 text-sm font-semibold rounded-md transition-all ${theme === 'system' ? 'bg-white dark:bg-slate-700 shadow-sm text-[#0054A6] dark:text-[#00AEEF]' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'}`}
                    >
                        <Monitor className="w-4 h-4 mr-2" />
                        Automático
                    </button>
                </div>
            </div>
        </div>
      </div>

      <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl shadow-sm overflow-hidden mb-8">
        <div className="px-6 py-4 border-b border-gray-200 dark:border-slate-800 bg-gray-50/50 dark:bg-slate-900/50">
            <h3 className="text-lg font-bold text-gray-800 dark:text-gray-100">Integraciones</h3>
        </div>
        <div className="p-6">
            <WebhookConfig />
        </div>
      </div>

      <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl shadow-sm overflow-hidden mb-8">
        <div className="px-6 py-4 border-b border-gray-200 dark:border-slate-800 bg-gray-50/50 dark:bg-slate-900/50">
            <h3 className="text-lg font-bold text-gray-800 dark:text-gray-100">Gestión de Accesos</h3>
        </div>
        <div className="p-6">
            <UserManagement />
        </div>
      </div>

      <TenantDeletionManager />
    </div>
  );
}

function WebhookConfig() {
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();
    const [webhookUrl, setWebhookUrl] = useState('');
    const [saving, setSaving] = useState(false);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!selectedTenant || selectedTenant.id === 'default' || accounts.length === 0) return;
        
        const loadWebhook = async () => {
            setLoading(true);
            try {
                const tokenResponse = await instance.acquireTokenSilent({
                    scopes: ["User.Read"],
                    account: accounts[0]
                });
                
                const res = await fetch(`/api/admin/config/webhook?tenantId=${selectedTenant.id}`, {
                    headers: { 'Authorization': `Bearer ${tokenResponse.idToken}` }
                });
                const json = await res.json();
                if (res.ok && json.webhook_url) {
                    setWebhookUrl(json.webhook_url);
                } else {
                    setWebhookUrl('');
                }
            } catch (e) {
                console.error("Error loading webhook:", e);
            }
            setLoading(false);
        };
        loadWebhook();
    }, [selectedTenant.id, accounts, instance]);

    const handleSave = async () => {
        if (!selectedTenant || selectedTenant.id === 'default' || accounts.length === 0) {
            toast.error("Selecciona un tenant válido primero.");
            return;
        }

        setSaving(true);
        try {
            const tokenResponse = await instance.acquireTokenSilent({
                scopes: ["User.Read"],
                account: accounts[0]
            });
            
            const res = await fetch('/api/admin/config/webhook', {
                method: 'POST',
                headers: { 
                    'Authorization': `Bearer ${tokenResponse.idToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ tenantId: selectedTenant.id, webhookUrl })
            });

            if (res.ok) {
                toast.success("Webhook configurado exitosamente.");
            } else {
                toast.error("Error al guardar el Webhook.");
            }
        } catch (e) {
            console.error("Error saving webhook:", e);
            toast.error("Error al conectar con el servidor.");
        }
        setSaving(false);
    };

    if (selectedTenant.id === 'default') {
        return <div className="text-sm text-gray-500">Selecciona un Tenant en el selector principal para configurar integraciones.</div>;
    }

    return (
        <div className="flex flex-col">
            <h4 className="font-semibold text-gray-900 dark:text-white">Alertas Proactivas (Teams/Slack)</h4>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 mb-4">Ingresa la URL del Webhook entrante para recibir notificaciones de anomalías y remediación en tu canal de mensajería.</p>
            
            {loading ? (
                <div className="text-sm text-gray-400">Cargando configuración...</div>
            ) : (
                <div className="flex items-center gap-4">
                    <input 
                        type="url" 
                        value={webhookUrl}
                        onChange={(e) => setWebhookUrl(e.target.value)}
                        placeholder="https://hooks.slack.com/services/..."
                        className="flex-1 px-4 py-2 border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-md focus:ring-[#0054A6] focus:border-[#0054A6] sm:text-sm"
                    />
                    <button
                        onClick={handleSave}
                        disabled={saving}
                        className="px-4 py-2 bg-[#0054A6] text-white rounded-md shadow-sm text-sm font-semibold hover:bg-[#004080] disabled:opacity-50 transition-colors"
                    >
                        {saving ? 'Guardando...' : 'Guardar Webhook'}
                    </button>
                </div>
            )}
        </div>
    );
}

function UserManagement() {
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();
    const [users, setUsers] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [isAdmin, setIsAdmin] = useState(false);

    useEffect(() => {
        if (!selectedTenant || selectedTenant.id === 'default' || accounts.length === 0) return;
        
        // Determine if current user is cscloudsolutions admin
        const userEmail = accounts[0].username.toLowerCase();
        setIsAdmin(userEmail.endsWith('@cscloudsolutions.com.ar'));

        const loadUsers = async () => {
            setLoading(true);
            try {
                const tokenResponse = await instance.acquireTokenSilent({
                    scopes: ["User.Read"],
                    account: accounts[0]
                });
                
                const res = await fetch(`/api/admin/config/users?tenantId=${selectedTenant.id}`, {
                    headers: { 'Authorization': `Bearer ${tokenResponse.idToken}` }
                });
                const json = await res.json();
                if (res.ok && json.users) {
                    setUsers(json.users);
                }
            } catch (e) {
                console.error("Error loading users:", e);
            }
            setLoading(false);
        };
        loadUsers();
    }, [selectedTenant.id, accounts, instance]);

    const handleDelete = async (userId: number, email: string) => {
        if (!confirm(`¿Estás seguro que deseas revocar el acceso local de ${email}?`)) return;

        try {
            const tokenResponse = await instance.acquireTokenSilent({
                scopes: ["User.Read"],
                account: accounts[0]
            });
            
            const res = await fetch(`/api/admin/config/users?tenantId=${selectedTenant.id}&userId=${userId}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${tokenResponse.idToken}` }
            });
            const json = await res.json();

            if (res.ok) {
                toast.success(json.message || "Usuario eliminado.");
                setUsers(users.filter(u => u.id !== userId));
            } else {
                toast.error(json.error || "Error al eliminar usuario.");
            }
        } catch (e) {
            console.error("Error deleting user:", e);
            toast.error("Error de conexión.");
        }
    };

    if (selectedTenant.id === 'default') {
        return <div className="text-sm text-gray-500">Selecciona un Tenant en el selector principal para ver los usuarios.</div>;
    }

    return (
        <div className="flex flex-col">
            <h4 className="font-semibold text-gray-900 dark:text-white">Usuarios Registrados en FinOpsProyect</h4>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 mb-4">Estos son los usuarios que han iniciado sesión localmente en este Tenant.</p>
            
            {loading ? (
                <div className="text-sm text-gray-400">Cargando usuarios...</div>
            ) : users.length === 0 ? (
                <div className="text-sm text-gray-500 bg-gray-50 dark:bg-slate-800 p-4 rounded-md border border-gray-100 dark:border-slate-700">No hay usuarios locales registrados.</div>
            ) : (
                <div className="border border-gray-200 dark:border-slate-700 rounded-md overflow-hidden bg-white dark:bg-slate-800">
                    <table className="min-w-full divide-y divide-gray-200 dark:divide-slate-700">
                        <thead className="bg-gray-50 dark:bg-slate-900">
                            <tr>
                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Email</th>
                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Rol</th>
                                <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Acciones</th>
                            </tr>
                        </thead>
                        <tbody className="bg-white dark:bg-slate-800 divide-y divide-gray-200 dark:divide-slate-700">
                            {users.map((user) => (
                                <tr key={user.id}>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-gray-100">{user.email}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400 capitalize">{user.role}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                        <button 
                                            onClick={() => handleDelete(user.id, user.email)}
                                            disabled={!isAdmin}
                                            className={`text-red-600 hover:text-red-900 dark:text-red-400 dark:hover:text-red-300 font-semibold ${!isAdmin ? 'opacity-30 cursor-not-allowed' : ''}`}
                                            title={!isAdmin ? "Solo Súper Administradores pueden borrar usuarios" : "Eliminar"}
                                        >
                                            Eliminar
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}

function TenantDeletionManager() {
    const { instance, accounts } = useMsal();
    const [tenants, setTenants] = useState<any[]>([]);
    const [selectedTenantId, setSelectedTenantId] = useState<string>('');
    const [isAdmin, setIsAdmin] = useState(false);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (accounts.length === 0) return;
        
        const userEmail = accounts[0].username.toLowerCase();
        setIsAdmin(userEmail.endsWith('@cscloudsolutions.com.ar'));

        if (!userEmail.endsWith('@cscloudsolutions.com.ar')) return;

        const loadTenants = async () => {
            setLoading(true);
            try {
                const tokenResponse = await instance.acquireTokenSilent({
                    scopes: ["User.Read"],
                    account: accounts[0]
                });
                
                const res = await fetch('/api/tenants', {
                    headers: { 'Authorization': `Bearer ${tokenResponse.idToken}` }
                });
                const json = await res.json();
                if (res.ok && json.tenants) {
                    setTenants(json.tenants);
                    if (json.tenants.length > 0) {
                        setSelectedTenantId(json.tenants[0].id);
                    }
                }
            } catch (e) {
                console.error("Error loading tenants for deletion manager:", e);
            }
            setLoading(false);
        };
        loadTenants();
    }, [accounts, instance]);

    if (!isAdmin) return null;

    const selectedTenant = tenants.find(t => t.id === selectedTenantId);

    return (
      <div className="bg-white dark:bg-slate-900 border border-red-200 dark:border-red-900/30 rounded-xl shadow-sm overflow-hidden mb-8">
        <div className="px-6 py-4 border-b border-red-100 dark:border-red-900/30 bg-red-50/50 dark:bg-red-900/10">
            <h3 className="text-lg font-bold text-red-600 dark:text-red-400">Zona de Peligro (Super Admin)</h3>
        </div>
        <div className="p-6">
            <div className="flex flex-col md:flex-row md:items-start justify-between">
                <div className="flex-1 mr-8">
                    <h4 className="font-semibold text-gray-900 dark:text-white">Eliminar Entorno (Tenant)</h4>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 mb-4">
                        Selecciona el tenant que deseas eliminar de forma permanente. Esta acción purgará todo el historial de métricas, políticas, presupuestos y usuarios registrados localmente. Esta acción no se puede deshacer.
                    </p>
                    
                    {loading ? (
                        <div className="text-sm text-gray-400">Cargando tenants...</div>
                    ) : (
                        <div className="max-w-xs">
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Seleccionar Tenant</label>
                            <select
                                value={selectedTenantId}
                                onChange={(e) => setSelectedTenantId(e.target.value)}
                                className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 rounded-md shadow-sm focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm bg-white dark:bg-slate-800"
                            >
                                {tenants.map(t => (
                                    <option key={t.id} value={t.id}>{t.name} ({t.id})</option>
                                ))}
                            </select>
                        </div>
                    )}
                </div>
                <div className="mt-6 md:mt-0 pt-4 md:pt-10">
                    {selectedTenant ? (
                        <DeleteTenantModal tenantId={selectedTenant.id} tenantName={selectedTenant.name} />
                    ) : (
                        <button disabled className="px-4 py-2 bg-gray-100 text-gray-400 rounded-md font-semibold text-sm cursor-not-allowed border border-gray-200">
                            Eliminar Tenant
                        </button>
                    )}
                </div>
            </div>
        </div>
      </div>
    );
}
