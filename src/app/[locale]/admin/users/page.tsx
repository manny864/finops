"use client";
import { useEffect, useState } from "react";
import { useTenant } from '@/components/TenantProvider';
import { useMsal } from '@azure/msal-react';
import { toast } from 'sonner';
import { Users, Shield, Plus, Trash2 } from "lucide-react";
import { isMockTenant } from '@/lib/mockData';


export default function UsersPage() {
    const { selectedTenant, userRole } = useTenant();
    const { instance, accounts } = useMsal();
    const [users, setUsers] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [inviting, setInviting] = useState(false);
    
    const [newEmail, setNewEmail] = useState('');
    const [newRole, setNewRole] = useState('Reader');
    const [newOid, setNewOid] = useState('');

    const isAdmin = userRole === 'Admin';

    const loadUsers = async () => {
        if (!selectedTenant || selectedTenant.id === 'default' || (accounts.length === 0 && !isMockTenant(selectedTenant?.id || ''))) return;
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

    useEffect(() => {
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

    const handleInvite = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newEmail || !newOid) {
            toast.error("El email y el ID de Entra (OID) son requeridos para invitar a un usuario.");
            return;
        }

        setInviting(true);
        try {
            const tokenResponse = await instance.acquireTokenSilent({
                scopes: ["User.Read"],
                account: accounts[0]
            });
            
            const res = await fetch('/api/admin/config/users', {
                method: 'POST',
                headers: { 
                    'Authorization': `Bearer ${tokenResponse.idToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    tenantId: selectedTenant.id,
                    email: newEmail,
                    entraOid: newOid,
                    role: newRole
                })
            });
            const json = await res.json();

            if (res.ok) {
                toast.success("Usuario agregado exitosamente.");
                setNewEmail('');
                setNewOid('');
                setNewRole('Reader');
                loadUsers(); // Reload to get new user ID
            } else {
                toast.error(json.error || "Error al agregar usuario.");
            }
        } catch (e) {
            console.error("Error adding user:", e);
            toast.error("Error de conexión.");
        }
        setInviting(false);
    };

    const handleRoleChange = async (userId: number, newRoleValue: string) => {
        try {
            const tokenResponse = await instance.acquireTokenSilent({
                scopes: ["User.Read"],
                account: accounts[0]
            });
            
            const res = await fetch('/api/admin/config/users', {
                method: 'PUT',
                headers: { 
                    'Authorization': `Bearer ${tokenResponse.idToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    tenantId: selectedTenant.id,
                    userId: userId,
                    role: newRoleValue
                })
            });
            const json = await res.json();

            if (res.ok) {
                toast.success("Rol actualizado exitosamente.");
                loadUsers();
            } else {
                toast.error(json.error || "Error al actualizar rol.");
            }
        } catch (e) {
            console.error("Error updating role:", e);
            toast.error("Error de conexión.");
        }
    };

    if (selectedTenant.id === 'default') {
        return (
            <div className="p-6 max-w-5xl mx-auto">
                <div className="text-sm text-gray-500">Selecciona un Tenant en el selector principal para ver los usuarios.</div>
            </div>
        );
    }

    return (
        <div className="p-6 max-w-5xl mx-auto animate-in fade-in duration-500">
            <div className="mb-8 border-b border-gray-200 dark:border-gray-800 pb-4">
                <h1 className="text-3xl font-extrabold text-gray-900 dark:text-white tracking-tight flex items-center">
                    <Users className="w-8 h-8 mr-3 text-[#0054A6] dark:text-[#00AEEF]" />
                    Usuarios y Permisos
                </h1>
                <p className="text-gray-500 dark:text-gray-400 mt-2">
                    Gestiona el acceso de tu equipo a FinOpsProyect. El límite de usuarios está determinado por tu suscripción ({selectedTenant.tier || 'Essential'}).
                </p>
            </div>

            {isAdmin && (
                <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl shadow-sm overflow-hidden mb-8">
                    <div className="px-6 py-4 border-b border-gray-200 dark:border-slate-800 bg-gray-50/50 dark:bg-slate-900/50 flex items-center gap-2">
                        <Plus className="w-5 h-5 text-gray-500" />
                        <h3 className="text-lg font-bold text-gray-800 dark:text-gray-100">Agregar Usuario</h3>
                    </div>
                    <div className="p-6">
                        <form onSubmit={handleInvite} className="flex flex-col md:flex-row gap-4 items-end">
                            <div className="flex-1 w-full">
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Email del Usuario (debe ser del dominio de la empresa)</label>
                                <input 
                                    type="email" 
                                    required
                                    value={newEmail}
                                    onChange={e => setNewEmail(e.target.value)}
                                    placeholder="usuario@tu-dominio.com"
                                    className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 rounded-md focus:ring-[#0054A6] focus:border-[#0054A6] bg-white dark:bg-slate-800 placeholder-gray-500 dark:placeholder-gray-400"
                                />
                            </div>
                            <div className="flex-1 w-full">
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Entra ID (OID) del usuario</label>
                                <input 
                                    type="text" 
                                    required
                                    value={newOid}
                                    onChange={e => setNewOid(e.target.value)}
                                    placeholder="00000000-0000-0000-0000-000000000000"
                                    className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 rounded-md focus:ring-[#0054A6] focus:border-[#0054A6] bg-white dark:bg-slate-800 placeholder-gray-500 dark:placeholder-gray-400"
                                />
                            </div>
                            <div className="w-full md:w-48">
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Rol</label>
                                <select 
                                    value={newRole}
                                    onChange={e => setNewRole(e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 rounded-md bg-white dark:bg-slate-800 placeholder-gray-500 dark:placeholder-gray-400"
                                >
                                    <option value="Reader">Reader (Lectura)</option>
                                    <option value="Colaborador">Colaborador</option>
                                    <option value="Admin">Admin</option>
                                </select>
                            </div>
                            <button 
                                type="submit"
                                disabled={inviting}
                                className="w-full md:w-auto px-6 py-2 bg-[#0054A6] text-white rounded-md font-semibold hover:bg-[#004080] disabled:opacity-50"
                            >
                                {inviting ? 'Guardando...' : 'Agregar'}
                            </button>
                        </form>
                    </div>
                </div>
            )}

            <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl shadow-sm overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-200 dark:border-slate-800 bg-gray-50/50 dark:bg-slate-900/50 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Shield className="w-5 h-5 text-gray-500" />
                        <h3 className="text-lg font-bold text-gray-800 dark:text-gray-100">Usuarios Registrados ({users.length})</h3>
                    </div>
                </div>
                <div className="p-6">
                    {loading ? (
                        <div className="text-sm text-gray-400">Cargando usuarios...</div>
                    ) : users.length === 0 ? (
                        <div className="text-sm text-gray-500 bg-gray-50 dark:bg-slate-800 p-4 rounded-md border border-gray-100 dark:border-slate-700">No hay usuarios locales registrados en esta cuenta.</div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="min-w-full divide-y divide-gray-200 dark:divide-slate-700">
                                <thead className="bg-gray-50 dark:bg-slate-900">
                                    <tr>
                                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Email</th>
                                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Entra ID</th>
                                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Rol</th>
                                        <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Acciones</th>
                                    </tr>
                                </thead>
                                <tbody className="bg-white dark:bg-slate-800 divide-y divide-gray-200 dark:divide-slate-700">
                                    {users.map((user) => (
                                        <tr key={user.id}>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-gray-100">{user.email}</td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400 font-mono text-xs">{user.entra_oid}</td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                                                {isAdmin ? (
                                                    <select 
                                                        value={user.role}
                                                        onChange={(e) => handleRoleChange(user.id, e.target.value)}
                                                        className="px-2 py-1 border border-gray-300 dark:border-slate-700 rounded bg-white dark:bg-slate-900 text-sm placeholder-gray-500 dark:placeholder-gray-400"
                                                    >
                                                        <option value="Reader">Reader</option>
                                                        <option value="Colaborador">Colaborador</option>
                                                        <option value="Admin">Admin</option>
                                                    </select>
                                                ) : (
                                                    <span className="capitalize">{user.role}</span>
                                                )}
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                                <button 
                                                    onClick={() => handleDelete(user.id, user.email)}
                                                    disabled={!isAdmin}
                                                    className={`text-red-600 hover:text-red-900 dark:text-red-400 dark:hover:text-red-300 flex items-center justify-end w-full gap-1 ${!isAdmin ? 'opacity-30 cursor-not-allowed' : ''}`}
                                                    title={!isAdmin ? "Solo Administradores pueden borrar usuarios" : "Eliminar"}
                                                >
                                                    <Trash2 className="w-4 h-4" /> Eliminar
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
