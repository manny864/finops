'use client';

import { useEffect, useRef, useState } from 'react';
import { usePendingDeletionsStore } from '@/store/pendingDeletionsStore';
import { useTranslations } from 'next-intl';

export default function BrowserNotificationProvider() {
  const t = useTranslations('common');
  const pendingDeletions = usePendingDeletionsStore((state) => state.pending);
  const removePending = usePendingDeletionsStore((state) => state.removePending);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const [permissionState, setPermissionState] = useState<NotificationPermission>('default');

  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      setPermissionState(Notification.permission);
    }
  }, []);

  const requestPermission = () => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      Notification.requestPermission().then((permission) => {
        setPermissionState(permission);
      }).catch(console.error);
    }
  };

  // Polling para chequear el estado de los recursos pendientes
  useEffect(() => {
    const pendingIds = Object.keys(pendingDeletions);
    
    if (pendingIds.length === 0) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    const checkStatus = async () => {
      // Agrupar por tenantId para hacer peticiones correctas
      const byTenant: Record<string, string[]> = {};
      pendingIds.forEach(id => {
        const item = pendingDeletions[id];
        if (!byTenant[item.tenantId]) byTenant[item.tenantId] = [];
        byTenant[item.tenantId].push(id);
      });

      for (const [tenantId, resourceIds] of Object.entries(byTenant)) {
        try {
          const res = await fetch('/api/resources/status', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tenantId, resourceIds })
          });

          if (res.ok) {
            const data = await res.json();
            const existingIds = new Set(data.existingResourceIds.map((id: string) => id.toLowerCase()));

            resourceIds.forEach(id => {
              // Si el ID consultado ya no existe en ARG
              if (!existingIds.has(id.toLowerCase())) {
                const item = pendingDeletions[id];
                
                // Mostrar notificacion de navegador si hay permiso
                if ('Notification' in window && Notification.permission === 'granted') {
                  new Notification('FinOps: Recurso Eliminado', {
                    body: `El recurso "${item.name}" ha sido eliminado exitosamente.`,
                    icon: '/icon.png' 
                  });
                }
                
                removePending(id);
              }
            });
          }
        } catch (error) {
          console.error("Error checking pending deletions status", error);
        }
      }
    };

    // Check inmediatamente si hay items
    checkStatus();

    // Luego cada 30 segundos
    intervalRef.current = setInterval(checkStatus, 30000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [pendingDeletions, removePending]);

  if (permissionState === 'default') {
    return (
      <div className="fixed bottom-4 left-4 z-50 bg-blue-50 border border-blue-200 text-blue-800 px-4 py-3 rounded-lg shadow-lg flex items-center gap-3 animate-in fade-in slide-in-from-bottom-5">
        <div>
          <p className="font-semibold text-sm">Habilitar notificaciones</p>
          <p className="text-xs opacity-90 mt-0.5">Recibe alertas cuando finalicen las tareas de fondo.</p>
        </div>
        <div className="flex items-center gap-2 ml-auto pl-4 border-l border-blue-200">
          <button 
            onClick={() => setPermissionState('denied')}
            className="text-xs font-medium text-blue-600 hover:text-blue-800 transition-colors"
          >
            Ahora no
          </button>
          <button 
            onClick={requestPermission}
            className="text-xs font-bold bg-blue-600 text-white px-3 py-1.5 rounded-md hover:bg-blue-700 transition-colors shadow-sm"
          >
            Activar
          </button>
        </div>
      </div>
    );
  }

  return null;
}
