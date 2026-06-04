"use client";
import { useEffect } from 'react';
import { useMsal } from '@azure/msal-react';

export default function AuthSync() {
  const { accounts } = useMsal();

  useEffect(() => {
    if (accounts.length > 0) {
      const account = accounts[0];
      const tenantId = account.tenantId;
      
      let domainName = "Entorno: " + tenantId.substring(0,8);
      const email = account.username || account.idTokenClaims?.preferred_username || "";
      if (email.includes('@')) {
          domainName = email.split('@')[1];
      }

      // Registro silencioso en MySQL
      fetch('/api/tenants', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ tenantId, name: domainName })
      }).catch(err => console.error("Fallo la sincronización en background:", err));
    }
  }, [accounts]);

  return null;
}
