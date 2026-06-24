import { NextResponse } from 'next/server';
import { getWithCache } from '@/lib/cache';

export async function GET() {
  try {
    const cacheKey = 'finops:azure:summary';

    // Usamos el utilitario de caché
    const data = await getWithCache(cacheKey, async () => {
      // Esta función SOLO se ejecuta si el dato NO está en Redis
      console.log('Consultando datos pesados desde el origen...');
      
      // Aquí iría tu llamada real a la API de Azure o Base de datos
      // Sustituye con tu lógica real o mantenlo para pruebas
      try {
        const response = await fetch('https://api.ejemplo.com/v1/costs');
        if (!response.ok) return { message: "Mock data fallback from status code" };
        return await response.json();
      } catch (e) {
        // El dominio de ejemplo no existe, por lo que fetch lanza error. Devolvemos mock.
        return { 
          source: "Mock data fallback", 
          cost: 1500, 
          currency: "USD",
          info: "La API externa no existe, este dato fue mockeado y será cacheado en Redis." 
        };
      }
    }, 600); // Guardar en caché por 10 minutos (600 segundos)

    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
