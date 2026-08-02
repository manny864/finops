'use client';

import { useEffect, useRef } from 'react';
import { usePendingDeletionsStore } from '@/store/pendingDeletionsStore';
import { useTranslations } from 'next-intl';

export default function BrowserNotificationProvider() {
  const t = useTranslations('common');
  const pendingDeletions = usePendingDeletionsStore((state) => state.pending);
  const removePending = usePendingDeletionsStore((state) => state.removePending);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  // Pedir permisos de notificacion al inicio de sesion si no se ha preguntado
  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      if (Notification.permission === 'default') {
        Notification.requestPermission().catch(console.error);
      }
    }
  }, []);

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
              // Si el ID consultado ya no existe en ARG (y pasaron al menos 30 segundos para evitar falsos positivos iniciales de cache de ARG)
              // Azure ARG suele tener 1-5 mins de consistencia, si desapareció, ya se borró seguro.
              if (!existingIds.has(id.toLowerCase())) {
                const item = pendingDeletions[id];
                
                // Mostrar notificacion de navegador si hay permiso
                if ('Notification' in window && Notification.permission === 'granted') {
                  new Notification('FinOps: Recurso Eliminado', {
                    body: `El recurso "${item.name}" ha sido eliminado exitosamente.`,
                    icon: '/icon.png' // Asegurate de tener un icono o se usará el default del navegador
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

  return null; // Componente sin UI, solo lógica de fondo
}
