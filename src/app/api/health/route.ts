import { NextResponse } from "next/server";

// Endpoint publico y liviano usado por el healthcheck de Docker
// (ver docker-compose.yml) y por Traefik para saber si el contenedor
// finops-app esta listo para recibir trafico. No requiere auth ni
// toca DB/Redis a proposito: solo confirma que el proceso Next.js
// esta arriba y respondiendo.
export async function GET() {
    return NextResponse.json({ status: "ok" }, { status: 200 });
}
