'use client';
import React, { useState } from 'react';

export default function RoleAssignmentBanner() {
    const [copied, setCopied] = useState(false);
    const clientId = process.env.NEXT_PUBLIC_CLIENT_ID || "876d8a5b-6023-4484-b3ba-73c186e4a72b";
    
    // Script automatizado que resuelve el Object ID a traves del Client ID y usa la sub actual.
    const cliCommand = `az role assignment create --assignee "${clientId}" --role "Reader" --scope "/subscriptions/$(az account show --query id -o tsv)"`;

    const handleCopy = () => {
        navigator.clipboard.writeText(cliCommand);
        setCopied(true);
        setTimeout(() => setCopied(false), 3000);
    };

    return (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 my-8 mx-4 shadow-sm">
            <div className="flex items-start">
                <div className="flex-shrink-0">
                    <svg className="h-6 w-6 text-blue-600 mt-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                </div>
                <div className="ml-4 w-full">
                    <h3 className="text-lg font-bold text-blue-900">Permiso de Lectura Requerido</h3>
                    <div className="mt-2 text-sm text-blue-800">
                        <p>Tu cuenta ha sido vinculada exitosamente, pero nuestra plataforma requiere permisos de Lector en tu Suscripción de Azure para detectar los recursos zombis y optimizar tus costos.</p>
                        <p className="mt-3 font-semibold">Ejecuta este comando seguro en tu consola de Azure para habilitarlo:</p>
                    </div>
                    
                    <div className="mt-4 relative">
                        <div className="bg-gray-900 rounded-md p-4 overflow-x-auto">
                            <code className="text-green-400 font-mono text-sm whitespace-pre">{cliCommand}</code>
                        </div>
                        <button 
                            onClick={handleCopy}
                            className="absolute top-2 right-2 bg-gray-700 hover:bg-gray-600 text-white text-xs px-3 py-1.5 rounded transition-colors"
                        >
                            {copied ? "¡Copiado!" : "Copiar"}
                        </button>
                    </div>
                    
                    <div className="mt-5 flex space-x-4">
                        <a 
                            href="https://portal.azure.com/#cloudshell/"
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                        >
                            Abrir Azure Cloud Shell
                            <svg className="ml-2 -mr-1 h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
                                <path d="M11 3a1 1 0 100 2h2.586l-6.293 6.293a1 1 0 101.414 1.414L15 6.414V9a1 1 0 102 0V4a1 1 0 00-1-1h-5z" />
                                <path d="M5 5a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2v-3a1 1 0 10-2 0v3H5V7h3a1 1 0 000-2H5z" />
                            </svg>
                        </a>
                    </div>
                </div>
            </div>
        </div>
    );
}
