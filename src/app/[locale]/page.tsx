"use client";
import { useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';

// El Dashboard General (grid legacy con react-grid-layout) fue reemplazado
// por White Board como landing post-login — ver commit 0c836b3 de esta
// sesión ("convierte White Board en dashboard ejecutivo"). Esta ruta ("/")
// sigue siendo el destino de MSAL tras el login (redirectUri = origin), así
// que en vez de eliminarla directamente la dejamos como redirect para no
// romper el flujo de login existente.
export default function Home() {
  const router = useRouter();
  const { locale } = useParams();

  useEffect(() => {
    // ClientShell.tsx también redirige "/" -> "/mobile" en teléfonos (salvo
    // que el usuario haya pedido la versión de escritorio). Replicamos el
    // mismo chequeo acá para no perder esa carrera: los effects de un hijo
    // (esta página) corren antes que los del padre (ClientShell) al montar,
    // así que sin esto el redirect a White Board le ganaría al de /mobile.
    const isPhone = typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches;
    const forceDesktop = typeof window !== 'undefined' && sessionStorage.getItem('finops:forceDesktop') === '1';
    if (isPhone && !forceDesktop) return;
    router.replace(`/${locale}/overview/whiteboard`);
  }, [router, locale]);

  return null;
}
