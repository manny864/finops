"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export async function setDemoSession(tier: string, provider: string = "azure") {
  const cookieStore = await cookies();
  // El proveedor se normaliza acá y no en el cliente: la cookie la lee el
  // layout server-side y un valor arbitrario terminaria eligiendo un tenant
  // de demo inexistente.
  const normalizedProvider = provider === "aws" ? "aws" : "azure";
  const sessionData = JSON.stringify({ isDemo: true, tier, provider: normalizedProvider });
  
  cookieStore.set("finops_demo_session", sessionData, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24, // 1 day
    path: "/",
  });

  redirect("/");
}

export async function exitDemoSession() {
  const cookieStore = await cookies();
  cookieStore.delete("finops_demo_session");
  redirect("/");
}
