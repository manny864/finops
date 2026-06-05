"use client";
import React from 'react';
import { useActionLogStore } from '@/store/actionLogStore';
import { X, CheckCircle, AlertCircle, Info, Trash2 } from 'lucide-react';

interface DrawerProps {
    open: boolean;
    onClose: () => void;
}

export default function ActionCenterDrawer({ open, onClose }: DrawerProps) {
    const { actions, clearActions } = useActionLogStore();

    return (
        <>
            {open && <div className="fixed inset-0 bg-black/20 dark:bg-black/40 backdrop-blur-sm z-40 transition-opacity" onClick={onClose} />}
            
            <div className={`fixed top-0 right-0 h-full w-96 bg-white dark:bg-slate-900 shadow-2xl z-50 transform transition-transform duration-300 ease-in-out border-l border-gray-200 dark:border-slate-800 flex flex-col ${open ? 'translate-x-0' : 'translate-x-full'}`}>
                <div className="h-16 px-6 border-b border-gray-200 dark:border-slate-800 flex items-center justify-between shrink-0 bg-gray-50 dark:bg-slate-950">
                    <h2 className="text-lg font-bold tracking-tight text-gray-900 dark:text-white">Centro de Acciones</h2>
                    <button onClick={onClose} className="p-2 rounded-full hover:bg-gray-200 dark:hover:bg-slate-800 text-gray-500 transition-colors">
                        <X className="w-5 h-5" />
                    </button>
                </div>
                
                <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
                    {actions.length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center text-center text-gray-500">
                            <Info className="w-10 h-10 mb-3 text-gray-300 dark:text-slate-700" />
                            <p>No hay acciones recientes.</p>
                        </div>
                    ) : (
                        actions.map(action => (
                            <div key={action.id} className="p-4 rounded-lg border border-gray-100 dark:border-slate-800 bg-white dark:bg-slate-800/50 shadow-sm flex items-start gap-3">
                                <div className="mt-0.5">
                                    {action.status === 'success' && <CheckCircle className="w-5 h-5 text-green-500" />}
                                    {action.status === 'error' && <AlertCircle className="w-5 h-5 text-red-500" />}
                                    {action.status === 'info' && <Info className="w-5 h-5 text-blue-500" />}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{action.message}</p>
                                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                        {action.timestamp.toLocaleTimeString()} - {action.timestamp.toLocaleDateString()}
                                    </p>
                                </div>
                            </div>
                        ))
                    )}
                </div>
                
                {actions.length > 0 && (
                    <div className="p-4 border-t border-gray-200 dark:border-slate-800 bg-gray-50 dark:bg-slate-950 shrink-0">
                        <button onClick={clearActions} className="w-full flex items-center justify-center py-2 px-4 border border-gray-300 dark:border-slate-700 rounded-md shadow-sm text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-slate-800 hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors">
                            <Trash2 className="w-4 h-4 mr-2" /> Limpiar Historial
                        </button>
                    </div>
                )}
            </div>
        </>
    );
}
