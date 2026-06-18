"use client";
import React, { useState } from 'react';
import { useMsal } from '@azure/msal-react';
import { AlertTriangle, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';

interface DeleteTenantModalProps {
    tenantId: string;
    tenantName: string;
}

export default function DeleteTenantModal({ tenantId, tenantName }: DeleteTenantModalProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [confirmationName, setConfirmationName] = useState('');
    const [isDeleting, setIsDeleting] = useState(false);
    const { instance, accounts } = useMsal();

    const isUnlocked = confirmationName === tenantName;

    const handleDelete = async () => {
        if (!isUnlocked || accounts.length === 0) return;
        setIsDeleting(true);

        try {
            const tokenResponse = await instance.acquireTokenSilent({
                scopes: ["User.Read"],
                account: accounts[0]
            });
            
            const res = await fetch(`/api/admin/tenants/delete`, {
                method: 'POST',
                headers: { 
                    'Authorization': `Bearer ${tokenResponse.idToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ tenantId })
            });

            const json = await res.json();

            if (res.ok) {
                toast.success(json.message || "Tenant eliminado con éxito.");
                // Redirect to root or reload page
                setTimeout(() => {
                    window.location.href = '/';
                }, 1500);
            } else {
                toast.error(json.error || "No se pudo eliminar el Tenant.");
                setIsDeleting(false);
            }
        } catch (e: any) {
            console.error("Error al eliminar tenant:", e);
            toast.error("Error de conexión al servidor.");
            setIsDeleting(false);
        }
    };

    if (!isOpen) {
        return (
            <button
                onClick={() => setIsOpen(true)}
                className="flex items-center px-4 py-2 bg-red-50 text-red-600 hover:bg-red-100 hover:text-red-700 rounded-md font-semibold text-sm transition-colors border border-red-200"
            >
                <Trash2 className="w-4 h-4 mr-2" />
                Eliminar Tenant
            </button>
        );
    }

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-0">
            {/* Backdrop */}
            <div 
                className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" 
                onClick={() => !isDeleting && setIsOpen(false)}
            />

            {/* Modal */}
            <div className="relative bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-200 border border-red-100 dark:border-red-900/30">
                <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-slate-800 bg-red-50/50 dark:bg-red-900/10">
                    <div className="flex items-center text-red-600 dark:text-red-400">
                        <AlertTriangle className="w-5 h-5 mr-2" />
                        <h3 className="text-lg font-bold">Zona de Peligro</h3>
                    </div>
                    <button 
                        onClick={() => !isDeleting && setIsOpen(false)}
                        className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                        disabled={isDeleting}
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>
                
                <div className="p-6">
                    <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed mb-4">
                        ¿Estás seguro de que deseas eliminar <span className="font-bold text-gray-900 dark:text-white">{tenantName}</span>? 
                        <span className="block mt-2 text-red-600 dark:text-red-400 font-medium">Esta acción es permanente y purgará por completo todos los registros relacionados en la base de datos (logs, presupuestos, historial).</span>
                    </p>

                    <div className="mt-6">
                        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                            Para confirmar, escribe el nombre del tenant exactamente como aparece arriba:
                        </label>
                        <input 
                            type="text" 
                            value={confirmationName}
                            onChange={(e) => setConfirmationName(e.target.value)}
                            placeholder={tenantName}
                            disabled={isDeleting}
                            className="w-full px-4 py-2 border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-md focus:ring-red-500 focus:border-red-500 sm:text-sm font-medium placeholder-gray-500 dark:placeholder-gray-400"
                        />
                    </div>
                </div>

                <div className="px-6 py-4 bg-gray-50 dark:bg-slate-800/50 flex justify-end gap-3 border-t border-gray-100 dark:border-slate-800">
                    <button
                        onClick={() => setIsOpen(false)}
                        disabled={isDeleting}
                        className="px-4 py-2 text-sm font-semibold text-gray-700 dark:text-gray-300 bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-600 rounded-md hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors disabled:opacity-50"
                    >
                        Cancelar
                    </button>
                    <button
                        onClick={handleDelete}
                        disabled={!isUnlocked || isDeleting}
                        className={`flex items-center px-4 py-2 text-sm font-semibold rounded-md transition-colors shadow-sm
                            ${isUnlocked && !isDeleting 
                                ? 'bg-red-600 text-white hover:bg-red-700 border border-transparent' 
                                : 'bg-red-100 text-red-400 border border-transparent cursor-not-allowed dark:bg-red-900/30 dark:text-red-500/50'
                            }
                        `}
                    >
                        {isDeleting ? (
                            <>
                                <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-current" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                                Eliminando...
                            </>
                        ) : (
                            'Confirmar Eliminación'
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
}
