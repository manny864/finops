"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export async function setDemoSession(tier: string, _provider: string = "azure") {
  const cookieStore = await cookies();
  const sessionData = JSON.stringify({ isDemo: true, tier, provider: "azure" });
  
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
