"use client";
import { useEffect } from 'react';
import { useMsal } from '@azure/msal-react';
import { getFreshIdToken } from '@/lib/msalToken';

export default function AuthSync() {
  const { instance, accounts } = useMsal();

  useEffect(() => {
    if (accounts.length > 0) {
      const account = accounts[0];
      const tenantId = account.tenantId;

      let domainName = "Entorno: " + tenantId.substring(0,8);
      const email = account.username || account.idTokenClaims?.preferred_username || "";
      if (email.includes('@')) {
          domainName = email.split('@')[1];
      }

      // Registro silencioso en MySQL. Requiere bearer token: POST /api/tenants
      // valida que el caller pertenezca al tenant que está sincronizando.
      (async () => {
        try {
          const idToken = await getFreshIdToken(instance, account);
          await fetch('/api/tenants', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${idToken}`,
            },
            body: JSON.stringify({ tenantId, name: domainName })
          });
        } catch (err) {
          console.error("Fallo la sincronización en background:", err);
        }
      })();
    }
  }, [instance, accounts]);

  return null;
}
