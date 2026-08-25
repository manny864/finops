"use client";
import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useMsal } from '@azure/msal-react';
import { AlertTriangle, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { useMfaChallenge } from '@/hooks/useMfaChallenge';

interface DeleteTenantModalProps {
    tenantId: string;
    tenantName: string;
    onDeleted?: () => void;
    trigger?: React.ReactNode;
}

export default function DeleteTenantModal({ tenantId, tenantName, onDeleted, trigger }: DeleteTenantModalProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [confirmationName, setConfirmationName] = useState('');
    const [isDeleting, setIsDeleting] = useState(false);
    const [mounted, setMounted] = useState(false);

    const { instance, accounts } = useMsal();
    const { requestChallenge, mfaModal } = useMfaChallenge();

    useEffect(() => {
        setMounted(true);
    }, []);

    const isUnlocked = confirmationName.trim() === tenantName.trim();

    const handleDelete = async () => {
        if (!isUnlocked || accounts.length === 0) return;
        setIsDeleting(true);

        try {
            // Operación sensible: solicitar MFA si el usuario tiene 2FA activado.
            const { challengeId, cancelled } = await requestChallenge('delete_tenant', { tenantId });
            if (cancelled) {
                setIsDeleting(false);
                return;
            }

            const tokenResponse = await instance.acquireTokenSilent({
                scopes: ["User.Read"],
                account: accounts[0]
            });
            
            const res = await fetch(`/api/admin/tenants/delete`, {
                method: 'POST',
                headers: { 
                    'Authorization': `Bearer ${tokenResponse.idToken}`,
                    'Content-Type': 'application/json',
                    ...(challengeId ? { 'X-MFA-Challenge-Id': challengeId } : {})
                },
                body: JSON.stringify({ tenantId })
            });

            const json = await res.json();

            if (res.ok) {
                toast.success(json.message || "Tenant eliminado con éxito.");
                setIsOpen(false);
                setConfirmationName('');
                setIsDeleting(false);
                if (onDeleted) {
                    onDeleted();
                } else {
                    // Fallback: Redirect to root
                    setTimeout(() => {
                        window.location.href = '/';
                    }, 1500);
                }
            } else {
                toast.error(json.error || "No se pudo eliminar el Tenant.");
                setIsDeleting(false);
            }
        } catch (e) {
            console.error("Error al eliminar tenant:", e);
            toast.error("Error de conexión al servidor.");
            setIsDeleting(false);
        }
    };

    const handleClose = () => {
        if (isDeleting) return;
        setIsOpen(false);
        setConfirmationName('');
    };

    if (!isOpen) {
        if (trigger) {
            return (
                <div onClick={() => setIsOpen(true)} className="inline-block cursor-pointer">
                    {trigger}
                </div>
            );
        }

        return (
            <button
                type="button"
                onClick={() => setIsOpen(true)}
                className="flex items-center px-4 py-2 bg-red-50 text-red-600 hover:bg-red-100 hover:text-red-700 rounded-md font-semibold text-sm transition-colors border border-red-200 dark:bg-red-950/40 dark:text-red-400 dark:border-red-900/50"
            >
                <Trash2 className="w-4 h-4 mr-2" />
                Eliminar Tenant
            </button>
        );
    }

    const modalContent = (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 sm:p-6 overflow-y-auto">
            {/* Backdrop */}
            <div 
                className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm transition-opacity" 
                onClick={handleClose}
                aria-hidden="true"
            />

            {/* Modal Box */}
            <div 
                className="relative bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-lg mx-auto overflow-hidden animate-in fade-in zoom-in-95 duration-200 border border-red-200/80 dark:border-red-900/40 z-10 my-8"
                role="dialog"
                aria-modal="true"
            >
                {/* Cabecera */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-rose-100 dark:border-slate-800 bg-rose-50/70 dark:bg-rose-950/30">
                    <div className="flex items-center gap-2.5 text-rose-600 dark:text-rose-400">
                        <div className="p-1.5 bg-rose-100 dark:bg-rose-900/50 rounded-lg">
                            <AlertTriangle className="w-5 h-5 shrink-0" />
                        </div>
                        <h3 className="text-base font-bold font-['Montserrat',sans-serif] text-slate-900 dark:text-white">
                            Eliminar Tenant
                        </h3>
                    </div>
                    <button 
                        type="button"
                        onClick={handleClose}
                        className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-lg transition-colors"
                        disabled={isDeleting}
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>
                
                {/* Cuerpo */}
                <div className="p-6 space-y-4 text-left">
                    <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed break-words whitespace-normal">
                        ¿Estás seguro de que deseas purgar de la plataforma el tenant <span className="font-bold text-slate-900 dark:text-white break-all">{tenantName}</span>?
                    </p>

                    <div className="p-3.5 bg-rose-50/80 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/40 rounded-xl text-rose-800 dark:text-rose-300 text-xs space-y-1">
                        <div className="font-bold flex items-center gap-1.5 text-rose-700 dark:text-rose-400">
                            <AlertTriangle className="w-4 h-4 shrink-0" />
                            <span>Esta acción es permanente e irreversible</span>
                        </div>
                        <p className="text-[11.5px] leading-relaxed opacity-90 break-words whitespace-normal pl-5">
                            Se purgarán por completo todos los registros asociados en la base de datos (usuarios, presupuestos, historial de costos y configuraciones).
                        </p>
                    </div>

                    <div className="pt-2">
                        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2 leading-relaxed break-words whitespace-normal">
                            Para confirmar, escribe el nombre del tenant exactamente:
                            <span className="block mt-1.5 font-mono text-xs font-bold text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900/50 px-2.5 py-1 rounded-lg select-all break-all">
                                {tenantName}
                            </span>
                        </label>
                        <input 
                            type="text" 
                            value={confirmationName}
                            onChange={(e) => setConfirmationName(e.target.value)}
                            placeholder={tenantName}
                            disabled={isDeleting}
                            autoFocus
                            className="w-full px-3.5 py-2.5 border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-xl focus:ring-2 focus:ring-rose-500 focus:border-rose-500 text-xs font-medium text-slate-800 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 transition-all shadow-xs"
                        />
                    </div>
                </div>

                {/* Footer */}
                <div className="px-6 py-4 bg-slate-50 dark:bg-slate-800/60 flex items-center justify-end gap-3 border-t border-slate-100 dark:border-slate-800">
                    <button
                        type="button"
                        onClick={handleClose}
                        disabled={isDeleting}
                        className="px-4 py-2 text-xs font-semibold text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors disabled:opacity-50 shadow-xs"
                    >
                        Cancelar
                    </button>
                    <button
                        type="button"
                        onClick={handleDelete}
                        disabled={!isUnlocked || isDeleting}
                        className={`flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-xl transition-all shadow-xs
                            ${isUnlocked && !isDeleting 
                                ? 'bg-rose-600 hover:bg-rose-700 text-white cursor-pointer hover:scale-[1.01]' 
                                : 'bg-rose-100 text-rose-400 border border-transparent cursor-not-allowed dark:bg-rose-950/30 dark:text-rose-600/60'
                            }
                        `}
                    >
                        {isDeleting ? (
                            <>
                                <svg className="animate-spin -ml-0.5 mr-1.5 h-3.5 w-3.5 text-current" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                                Purgando...
                            </>
                        ) : (
                            'Confirmar Eliminación'
                        )}
                    </button>
                </div>
            </div>
            {mfaModal}
        </div>
    );

    if (!mounted) return null;
    return createPortal(modalContent, document.body);
}
