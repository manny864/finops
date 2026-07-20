"use client";
import { useEffect, useRef, useState } from "react";
import { useTenant } from '@/components/TenantProvider';
import { useMsal } from '@azure/msal-react';
import { toast } from 'sonner';
import { Users, Shield, Plus, Trash2, RefreshCw, X, CheckSquare, ChevronDown } from "lucide-react";
import { isMockTenant } from '@/lib/mockData';
import { getFreshIdToken } from '@/lib/msalToken';
import { ASSIGNABLE_PERMISSIONS, parsePermissions, type RoleTag } from '@/lib/pageRoleTags';
import Pagination, { usePagination } from '@/components/Pagination';
import ResizableTh from '@/components/ResizableTh';

// Dropdown desplegable de selección múltiple para Permisos (dominio de
// páginas). Cierra al hacer click afuera; cada instancia maneja su propio
// estado abierto/cerrado (varias pueden coexistir, una por fila de tabla).
// El panel usa position:fixed calculado desde el rect del botón (no
// `absolute` dentro del <td>) porque la tabla vive en un contenedor con
// `overflow-x-auto` (directiva de tablas responsive) — overflow-x distinto
// de visible fuerza overflow-y a auto también, así que un panel absolute
// quedaría recortado por el borde de la tabla en filas cercanas al final.
function PermissionsMultiSelect({
    value,
    onChange,
    disabled,
}: {
    value: RoleTag[];
    onChange: (next: RoleTag[]) => void;
    disabled?: boolean;
}) {
    const [open, setOpen] = useState(false);
    const [coords, setCoords] = useState({ top: 0, left: 0, width: 0 });
    const btnRef = useRef<HTMLButtonElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        const reposition = () => {
            const rect = btnRef.current?.getBoundingClientRect();
            if (rect) setCoords({ top: rect.bottom + 4, left: rect.left, width: rect.width });
        };
        reposition();
        const handleClickOutside = (e: MouseEvent) => {
            if (
                btnRef.current && !btnRef.current.contains(e.target as Node) &&
                panelRef.current && !panelRef.current.contains(e.target as Node)
            ) {
                setOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        window.addEventListener('scroll', reposition, true);
        window.addEventListener('resize', reposition);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            window.removeEventListener('scroll', reposition, true);
            window.removeEventListener('resize', reposition);
        };
    }, [open]);

    const toggle = (tag: RoleTag) => {
        onChange(value.includes(tag) ? value.filter(t => t !== tag) : [...value, tag]);
    };

    const label = value.length === 0
        ? 'Sin permisos'
        : value.length === ASSIGNABLE_PERMISSIONS.length
        ? 'Todos'
        : ASSIGNABLE_PERMISSIONS.filter(p => value.includes(p.value)).map(p => p.value).join(', ');

    return (
        <>
            <button
                ref={btnRef}
                type="button"
                disabled={disabled}
                onClick={() => setOpen(o => !o)}
                className={`flex items-center justify-between gap-2 px-2.5 py-1.5 border rounded-md text-xs bg-white dark:bg-slate-900 border-gray-300 dark:border-slate-700 text-gray-700 dark:text-gray-300 min-w-[150px] ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer hover:border-[#0054A6]'}`}
            >
                <span className="truncate">{label}</span>
                <ChevronDown className={`w-3.5 h-3.5 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
            </button>
            {open && !disabled && (
                <div
                    ref={panelRef}
                    style={{ position: 'fixed', top: coords.top, left: coords.left, width: Math.max(coords.width, 224) }}
                    className="z-50 rounded-md border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg py-1"
                >
                    {ASSIGNABLE_PERMISSIONS.map(p => {
                        const active = value.includes(p.value);
                        return (
                            <label
                                key={p.value}
                                className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-800 cursor-pointer"
                            >
                                <input
                                    type="checkbox"
                                    checked={active}
                                    onChange={() => toggle(p.value)}
                                    className="rounded border-gray-300 dark:border-slate-600 text-[#0054A6] focus:ring-[#0054A6]"
                                />
                                {p.label}
                            </label>
                        );
                    })}
                </div>
            )}
        </>
    );
}


export default function UsersPage() {
    const { selectedTenant, userRole, systemRole } = useTenant();
    const { instance, accounts } = useMsal();
    const [users, setUsers] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [inviting, setInviting] = useState(false);
    
    const [newEmail, setNewEmail] = useState('');
    const [newRole, setNewRole] = useState('Reader');
    const [newPermissions, setNewPermissions] = useState<RoleTag[]>([]);
    const [newOid, setNewOid] = useState('');
    const [entraUsers, setEntraUsers] = useState<any[]>([]);
    const [syncingEntra, setSyncingEntra] = useState(false);
    const [showEntraModal, setShowEntraModal] = useState(false);
    const [selectedEntraUsers, setSelectedEntraUsers] = useState<{ [id: string]: { selected: boolean, role: string, user: any } }>({});
    const [provisioning, setProvisioning] = useState(false);

    // Owner (dueño del tenant) es superset de Admin — también gestiona
    // usuarios. Sin incluirlo acá, el creador del tenant (ahora Owner) quedaba
    // bloqueado de esta misma página.
    const isAdmin = userRole === 'Admin' || userRole === 'Owner' || systemRole === 'SUPERADMIN';
    const isSuperAdmin = systemRole === 'SUPERADMIN';
    // Solo un Owner existente (o SuperAdmin) puede otorgar el rol Owner —
    // transferencia de propiedad. Evita que un Admin se autopromocione a dueño.
    const canAssignOwner = userRole === 'Owner' || systemRole === 'SUPERADMIN';
    const isMasterTenant = selectedTenant.id === '8b41364f-581a-4e43-b7cb-13138dac5517';
    const { page, setPage, pageSize, setPageSize, total, totalPages, paged: pagedUsers } = usePagination(users, 15);

    const loadUsers = async () => {
        if (!selectedTenant || selectedTenant.id === 'default' || (accounts.length === 0 && !isMockTenant(selectedTenant?.id || ''))) return;
        setLoading(true);
        try {
            const tokenResponse = { idToken: await getFreshIdToken(instance, accounts[0]) };
            
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
            const tokenResponse = { idToken: await getFreshIdToken(instance, accounts[0]) };
            
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
            const tokenResponse = { idToken: await getFreshIdToken(instance, accounts[0]) };
            
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
                    role: newRole,
                    permissions: newPermissions
                })
            });
            const json = await res.json();

            if (res.ok) {
                toast.success("Usuario agregado exitosamente.");
                setNewEmail('');
                setNewOid('');
                setNewRole('Reader');
                setNewPermissions([]);
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

    const handleSyncEntra = async () => {
        setSyncingEntra(true);
        setShowEntraModal(true);
        try {
            const tokenResponse = { idToken: await getFreshIdToken(instance, accounts[0]) };
            const res = await fetch(`/api/admin/config/users/entra-sync`, {
                headers: { 'Authorization': `Bearer ${tokenResponse.idToken}` }
            });
            const json = await res.json();
            if (res.ok && json.users) {
                setEntraUsers(json.users);
                const initialSelected: any = {};
                json.users.forEach((u: any) => {
                    initialSelected[u.id] = { selected: false, role: 'Reader', user: u };
                });
                setSelectedEntraUsers(initialSelected);
            } else {
                toast.error(json.error || "Error al sincronizar con Entra ID");
            }
        } catch(e) {
            console.error("Error syncing Entra:", e);
            toast.error("Error de conexión al sincronizar.");
        }
        setSyncingEntra(false);
    };

    const handleBulkProvision = async () => {
        const usersToProvision = Object.values(selectedEntraUsers)
            .filter(item => item.selected)
            .map(item => ({
                entraOid: item.user.id,
                email: item.user.mail || item.user.userPrincipalName,
                displayName: item.user.displayName,
                role: item.role
            }));

        if (usersToProvision.length === 0) {
            toast.error("Selecciona al menos un usuario para provisionar.");
            return;
        }

        setProvisioning(true);
        try {
            const tokenResponse = { idToken: await getFreshIdToken(instance, accounts[0]) };
            const res = await fetch('/api/admin/config/users', {
                method: 'POST',
                headers: { 
                    'Authorization': `Bearer ${tokenResponse.idToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    tenantId: selectedTenant.id,
                    users: usersToProvision
                })
            });
            const json = await res.json();

            if (res.ok) {
                toast.success(json.message || "Usuarios provisionados.");
                setShowEntraModal(false);
                loadUsers();
            } else {
                toast.error(json.error || "Error al provisionar usuarios.");
            }
        } catch (e) {
            console.error("Error bulk provisioning:", e);
            toast.error("Error de conexión.");
        }
        setProvisioning(false);
    };

    const handleRoleChange = async (userId: number, newRoleValue: string) => {
        try {
            const tokenResponse = { idToken: await getFreshIdToken(instance, accounts[0]) };
            
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

    // Permisos de dominio (FinOps/CloudAdmin/Security/ProductOwner) — INDEPENDIENTES
    // del rol. Se persisten con el mismo endpoint PUT, mandando solo `permissions`
    // (el backend no toca `role` si no viene en el body).
    const handlePermissionsChange = async (userId: number, next: RoleTag[]) => {
        try {
            const tokenResponse = { idToken: await getFreshIdToken(instance, accounts[0]) };
            const res = await fetch('/api/admin/config/users', {
                method: 'PUT',
                headers: { 'Authorization': `Bearer ${tokenResponse.idToken}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ tenantId: selectedTenant.id, userId, permissions: next })
            });
            const json = await res.json();
            if (res.ok) {
                setUsers(prev => prev.map(u => u.id === userId ? { ...u, permissions: next } : u));
            } else {
                toast.error(json.error || "Error al actualizar permisos.");
            }
        } catch (e) {
            console.error("Error updating permissions:", e);
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
                    Gestiona el acceso de tu equipo a FinOpsProyect. El límite de usuarios está determinado por tu suscripción 
                    ({selectedTenant.tier === 'Enterprise' ? 'Enterprise: Sin límites' : 
                      selectedTenant.tier === 'Business' ? 'Business: Máx 20 usuarios' : 
                      selectedTenant.tier === 'Professional' ? 'Professional: Máx 5 usuarios' : 
                      'Essential: Máx 1 usuario'}).
                </p>
            </div>

            {isAdmin && (
                <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl shadow-sm overflow-hidden mb-8">
                    <div className="px-6 py-4 border-b border-gray-200 dark:border-slate-800 bg-gray-50/50 dark:bg-slate-900/50 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <Plus className="w-5 h-5 text-gray-500" />
                            <h3 className="text-lg font-bold text-gray-800 dark:text-gray-100">Agregar Usuario Manualmente</h3>
                        </div>
                        <button 
                            onClick={handleSyncEntra}
                            className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-md text-sm font-medium transition-colors"
                        >
                            <RefreshCw className={`w-4 h-4 ${syncingEntra ? 'animate-spin' : ''}`} />
                            Sincronizar desde Entra ID
                        </button>
                    </div>
                    <div className="p-6">
                        <form onSubmit={handleInvite} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-12 gap-4 items-end">
                            <div className="lg:col-span-4 w-full">
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
                            <div className="lg:col-span-4 w-full">
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
                            <div className="lg:col-span-2 w-full">
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Rol</label>
                                <select 
                                    value={newRole}
                                    onChange={e => setNewRole(e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 rounded-md bg-white dark:bg-slate-800 placeholder-gray-500 dark:placeholder-gray-400"
                                >
                                    <option value="Reader">Reader (Lectura)</option>
                                    <option value="Colaborador">Colaborador</option>
                                    <option value="Admin">Admin</option>
                                    <option value="Owner" disabled={!canAssignOwner}>Owner (Dueño)</option>
                                    {isSuperAdmin && isMasterTenant && (
                                        <option value="SuperAdmin">🛡️ SuperAdmin (Global)</option>
                                    )}
                                </select>
                            </div>
                            <div className="lg:col-span-2 w-full">
                                <button
                                    type="submit"
                                    disabled={inviting}
                                    className="w-full px-6 py-2 bg-[#0054A6] text-white rounded-md font-semibold hover:bg-[#004080] disabled:opacity-50"
                                >
                                    {inviting ? 'Guardando...' : 'Agregar'}
                                </button>
                            </div>
                            <div className="lg:col-span-12 w-full">
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                    Permisos (dominio de páginas — opcional, independiente del Rol)
                                </label>
                                <PermissionsMultiSelect value={newPermissions} onChange={setNewPermissions} />
                            </div>
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
                        <div className="overflow-x-auto custom-scrollbar" style={{ scrollbarWidth: 'thin' }}>
                            <table className="min-w-full table-fixed divide-y divide-gray-200 dark:divide-slate-700">
                                <thead className="bg-gray-50 dark:bg-slate-900">
                                    <tr>
                                        <ResizableTh minWidth={140} className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Nombre</ResizableTh>
                                        <ResizableTh minWidth={180} className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Email</ResizableTh>
                                        <ResizableTh minWidth={140} className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Entra ID</ResizableTh>
                                        <ResizableTh minWidth={140} className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Rol</ResizableTh>
                                        <ResizableTh minWidth={170} className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Permisos</ResizableTh>
                                        {/* sticky: la suma de minWidths de las columnas anteriores supera el
                                            ancho del contenedor (max-w-5xl) en viewports normales, y el botón de
                                            eliminar quedaba fuera de vista sin ningún indicio de que había que
                                            scrollear — lo fijamos al borde derecho del scroll container. */}
                                        <ResizableTh minWidth={130} className="sticky right-0 z-10 bg-gray-50 dark:bg-slate-900 px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider shadow-[-4px_0_4px_-4px_rgba(0,0,0,0.15)]">Acciones</ResizableTh>
                                    </tr>
                                </thead>
                                <tbody className="bg-white dark:bg-slate-800 divide-y divide-gray-200 dark:divide-slate-700">
                                    {pagedUsers.map((user) => (
                                        <tr key={user.id}>
                                            <td className="px-6 py-4 whitespace-normal break-words text-sm font-medium text-gray-900 dark:text-gray-100">{user.display_name || '-'}</td>
                                            <td className="px-6 py-4 whitespace-normal break-words text-sm text-gray-500 dark:text-gray-400">{user.email}</td>
                                            <td className="px-6 py-4 whitespace-normal break-words text-sm text-gray-500 dark:text-gray-400 font-mono text-xs">{user.entra_oid}</td>
                                            <td className="px-6 py-4 whitespace-normal break-words text-sm text-gray-500 dark:text-gray-400">
                                                {isAdmin ? (
                                                    <select
                                                        value={user.system_role === 'SUPERADMIN' ? 'SuperAdmin' : user.role}
                                                        onChange={(e) => handleRoleChange(user.id, e.target.value)}
                                                        title={user.system_role === 'SUPERADMIN' ? 'SuperAdmin (acceso global)' : undefined}
                                                        className={`w-full px-2 py-1 border rounded bg-white dark:bg-slate-900 text-sm placeholder-gray-500 dark:placeholder-gray-400 ${user.system_role === 'SUPERADMIN' ? 'border-amber-300 dark:border-amber-800 text-amber-800 dark:text-amber-400 font-semibold' : 'border-gray-300 dark:border-slate-700'}`}
                                                    >
                                                    <option value="Reader">Reader</option>
                                                        <option value="Colaborador">Colaborador</option>
                                                        <option value="Admin">Admin</option>
                                                        <option value="Owner" disabled={!canAssignOwner}>Owner (Dueño)</option>
                                                        {isSuperAdmin && isMasterTenant && (
                                                            <option value="SuperAdmin">🛡️ SuperAdmin</option>
                                                        )}
                                                    </select>
                                                ) : (
                                                    <span className="capitalize">{user.role}</span>
                                                )}
                                            </td>
                                            <td className="px-6 py-4 text-sm">
                                                {/* Permisos = dominio de páginas visible (FinOps/CloudAdmin/Security/
                                                    ProductOwner), independiente del Rol de la columna anterior — ambos
                                                    se aplican juntos, no son alternativos. Admin/Owner ven todo sin
                                                    necesidad de permisos asignados. */}
                                                <PermissionsMultiSelect
                                                    value={parsePermissions(user.permissions)}
                                                    onChange={(next) => handlePermissionsChange(user.id, next)}
                                                    disabled={!isAdmin}
                                                />
                                            </td>
                                            <td className="sticky right-0 z-10 bg-white dark:bg-slate-800 px-6 py-4 whitespace-nowrap text-right text-sm font-medium shadow-[-4px_0_4px_-4px_rgba(0,0,0,0.15)]">
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
                            <Pagination page={page} setPage={setPage} pageSize={pageSize} setPageSize={setPageSize} total={total} totalPages={totalPages} />
                        </div>
                    )}
                </div>
            </div>

            {/* Entra ID Modal */}
            {showEntraModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
                    <div className="bg-white dark:bg-slate-900 rounded-xl shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col">
                        <div className="px-6 py-4 border-b border-gray-200 dark:border-slate-800 flex justify-between items-center">
                            <h3 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
                                <Users className="w-5 h-5" /> Importar desde Microsoft Entra ID
                            </h3>
                            <button onClick={() => setShowEntraModal(false)} className="text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">
                                <X className="w-6 h-6" />
                            </button>
                        </div>
                        <div className="p-6 flex-1 overflow-y-auto">
                            {syncingEntra ? (
                                <div className="flex justify-center items-center h-32">
                                    <RefreshCw className="w-8 h-8 text-[#0054A6] animate-spin" />
                                </div>
                            ) : entraUsers.length === 0 ? (
                                <div className="text-center text-gray-500 py-8">No se encontraron usuarios o hubo un error de conexión con Microsoft Graph. Asegúrate de haber otorgado el Admin Consent en el Portal de Azure.</div>
                            ) : (
                                <table className="min-w-full divide-y divide-gray-200 dark:divide-slate-700">
                                    <thead className="bg-gray-50 dark:bg-slate-800">
                                        <tr>
                                            <th className="px-4 py-3 text-left">Seleccionar</th>
                                            <th className="px-4 py-3 text-left">Nombre</th>
                                            <th className="px-4 py-3 text-left">Email</th>
                                            <th className="px-4 py-3 text-left">Rol a asignar</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                                        {entraUsers.map((u: any) => {
                                            const state = selectedEntraUsers[u.id];
                                            if (!state) return null;
                                            return (
                                                <tr key={u.id} className="hover:bg-gray-50 dark:hover:bg-slate-800/50">
                                                    <td className="px-4 py-3">
                                                        <input 
                                                            type="checkbox" 
                                                            checked={state.selected}
                                                            onChange={(e) => setSelectedEntraUsers({...selectedEntraUsers, [u.id]: { ...state, selected: e.target.checked }})}
                                                            className="w-4 h-4 text-[#0054A6] rounded border-gray-300 focus:ring-[#0054A6]"
                                                        />
                                                    </td>
                                                    <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-white">{u.displayName}</td>
                                                    <td className="px-4 py-3 text-sm text-gray-500">{u.mail || u.userPrincipalName}</td>
                                                    <td className="px-4 py-3">
                                                        <select 
                                                            value={state.role}
                                                            onChange={(e) => setSelectedEntraUsers({...selectedEntraUsers, [u.id]: { ...state, role: e.target.value }})}
                                                            disabled={!state.selected}
                                                            className="text-sm border border-gray-300 dark:border-slate-700 rounded bg-white dark:bg-slate-900 disabled:opacity-50 px-2 py-1"
                                                        >
                                                            <option value="Reader">Reader</option>
                                                            <option value="Colaborador">Colaborador</option>
                                                            <option value="Admin">Admin</option>
                                                            <option value="Owner" disabled={!canAssignOwner}>Owner (Dueño)</option>
                                                            {isSuperAdmin && isMasterTenant && (
                                                                <option value="SuperAdmin">🛡️ SuperAdmin</option>
                                                            )}
                                                        </select>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            )}
                        </div>
                        <div className="px-6 py-4 border-t border-gray-200 dark:border-slate-800 flex justify-end gap-3 bg-gray-50 dark:bg-slate-900/50">
                            <button onClick={() => setShowEntraModal(false)} className="px-4 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 font-medium">Cancelar</button>
                            <button 
                                onClick={handleBulkProvision}
                                disabled={provisioning || Object.values(selectedEntraUsers).filter(i => i.selected).length === 0}
                                className="px-6 py-2 bg-[#0054A6] hover:bg-[#004080] text-white rounded-md font-medium disabled:opacity-50 flex items-center gap-2"
                            >
                                {provisioning && <RefreshCw className="w-4 h-4 animate-spin" />}
                                Provisionar Seleccionados
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
