import os
import subprocess

def main():
    base_dir = "/Users/manuelchavez/Documents/FinOpsProyect"
    print("Iniciando inyección de refinamientos visuales y MSAL Redirect...")
    
    # 1. Update AuthProvider.tsx
    auth_path = os.path.join(base_dir, "src", "components", "AuthProvider.tsx")
    auth_code = """"use client";
import React, { ReactNode, useEffect, useState } from "react";
import { PublicClientApplication, EventType, AuthenticationResult } from "@azure/msal-browser";
import { MsalProvider, useMsal } from "@azure/msal-react";

const pca = new PublicClientApplication({
    auth: {
        clientId: process.env.NEXT_PUBLIC_CLIENT_ID || "not-configured",
        authority: "https://login.microsoftonline.com/common",
        redirectUri: typeof window !== "undefined" ? window.location.origin : "/",
    }
});

export function AuthButton() {
    const { instance, accounts, inProgress } = useMsal();

    const handleLogin = () => {
        instance.loginRedirect({
            scopes: ["User.Read", "Directory.Read.All"]
        }).catch(e => console.error("Error al iniciar loginRedirect:", e));
    };

    if (accounts.length > 0) {
        return (
            <div className="flex items-center space-x-3 px-3">
                <div className="w-9 h-9 rounded-full bg-[var(--color-primary)] flex items-center justify-center text-white font-bold shadow-sm">
                    {accounts[0].name?.charAt(0) || "U"}
                </div>
                <div className="hidden md:block">
                    <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">{accounts[0].name}</p>
                    <p className="text-xs text-gray-500">{accounts[0].username}</p>
                </div>
            </div>
        );
    }

    if (inProgress === "startup" || inProgress === "handleRedirect") {
        return <span className="text-gray-400 text-sm font-medium animate-pulse px-4">Validando sesión...</span>;
    }

    return (
        <button 
            onClick={handleLogin}
            className="flex items-center justify-center space-x-2 bg-[#0054A6] hover:bg-[#004080] text-white px-5 py-2.5 rounded-lg text-sm font-semibold transition-all shadow-md active:scale-95"
        >
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M11.4 24H0V12.6h11.4V24zM24 24H12.6V12.6H24V24zM11.4 11.4H0V0h11.4v11.4zm12.6 0H12.6V0H24v11.4z"/></svg>
            <span>Iniciar sesión con Microsoft</span>
        </button>
    );
}

export default function AuthProvider({ children }: { children: ReactNode }) {
    const [msalInitialized, setMsalInitialized] = useState(false);

    useEffect(() => {
        pca.initialize().then(() => {
            setMsalInitialized(true);

            // Escuchamos silenciosamente cuando MSAL termina el Redirect exitosamente
            pca.addEventCallback((event) => {
                if (event.eventType === EventType.LOGIN_SUCCESS && event.payload) {
                    const payload = event.payload as AuthenticationResult;
                    const accessToken = payload.accessToken;
                    
                    console.log("Login exitoso. Ejecutando registro/onboarding en BD silente...");
                    fetch('/api/onboard', {
                        method: 'POST',
                        headers: { 'Authorization': `Bearer ${accessToken}` }
                    }).then(res => res.json()).then(data => {
                        if (data.success) {
                            console.log("Onboarding en Base de Datos exitoso.");
                        } else {
                            console.error("Fallo Onboarding DB:", data.error);
                        }
                    }).catch(err => console.error("Error Fetch Onboard:", err));
                }
            });

        }).catch(e => {
            console.error("Error inicializando MSAL:", e);
        });
    }, []);

    if (!msalInitialized) {
        return <>{children}</>;
    }

    return (
        <MsalProvider instance={pca}>
            {children}
        </MsalProvider>
    );
}
"""
    with open(auth_path, "w") as f:
        f.write(auth_code)

    # 2. Update ClientShell.tsx
    shell_path = os.path.join(base_dir, "src", "components", "ClientShell.tsx")
    shell_code = """"use client";
import React, { useState } from 'react';
import AuthProvider, { AuthButton } from "./AuthProvider";

export default function ClientShell({ children }: { children: React.ReactNode }) {
  return <AuthProvider><ShellContent>{children}</ShellContent></AuthProvider>;
}

function ShellContent({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(true);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex text-gray-900 dark:text-gray-100">
      {/* Sidebar */}
      <aside className={`${sidebarOpen ? 'w-64' : 'w-20'} bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 transition-all duration-300 flex flex-col`}>
        <div className="h-16 flex items-center justify-center border-b border-gray-200 dark:border-gray-700 px-4">
          <div className="flex items-center justify-center overflow-hidden w-full h-full">
             {sidebarOpen ? (
                <img src="/logo.png" alt="CSCloudSolutions FinOps" className="h-10 w-auto object-contain" />
             ) : (
                <div className="w-10 h-10 bg-[#0054A6] rounded-md flex items-center justify-center text-white font-bold text-xl shadow-sm">CS</div>
             )}
          </div>
        </div>
        <nav className="flex-1 py-6 px-3 space-y-2 overflow-y-auto">
          {/* Navigation Items */}
          <a href="#" className="flex items-center space-x-3 px-3 py-2.5 bg-blue-50 dark:bg-blue-900/20 text-[#0054A6] dark:text-[#00AEEF] rounded-lg font-semibold transition-colors">
            <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z"></path></svg>
            {sidebarOpen && <span>Dashboard Central</span>}
          </a>
        </nav>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between px-6 z-10 shadow-sm">
          <div className="flex items-center">
            <button onClick={() => setSidebarOpen(!sidebarOpen)} className="p-2 mr-4 text-gray-400 hover:text-[#0054A6] dark:hover:text-white transition-colors focus:outline-none">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16"></path></svg>
            </button>
            <h1 className="text-xl font-bold text-gray-800 dark:text-white hidden sm:block tracking-tight">Cloud FinOps</h1>
          </div>
          
          <div className="flex items-center space-x-6">
            {/* Tenant Selector (Admin CS Only) */}
            <div className="hidden md:flex items-center border border-gray-200 dark:border-gray-700 rounded-lg px-4 py-2 bg-gray-50/50 dark:bg-gray-800 relative group cursor-not-allowed">
              <div className="flex flex-col">
                 <span className="text-[10px] text-[#00AEEF] font-bold uppercase tracking-wider">Tenant (Admin Propietario)</span>
                 <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">CSCloudSolutions Global</span>
              </div>
              <svg className="w-4 h-4 ml-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
            </div>
            
            {/* Functional Login Button directly from AuthProvider */}
            <AuthButton />
          </div>
        </header>

        <main className="flex-1 overflow-y-auto bg-gray-50/50 dark:bg-gray-900 p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
"""
    with open(shell_path, "w") as f:
        f.write(shell_code)

    # 3. Update layout.tsx
    layout_path = os.path.join(base_dir, "src", "app", "layout.tsx")
    layout_code = """import type { Metadata } from "next";
import { Montserrat, Open_Sans } from "next/font/google";
import "./globals.css";
import ClientShell from "@/components/ClientShell";

const montserrat = Montserrat({
  subsets: ["latin"],
  variable: "--font-montserrat",
});

const openSans = Open_Sans({
  subsets: ["latin"],
  variable: "--font-opensans",
});

export const metadata: Metadata = {
  title: "CSCloudSolutions FinOps",
  description: "Plataforma automatizada para optimización de costos en Azure y gobernanza cloud.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" className={`${montserrat.variable} ${openSans.variable}`}>
      <body className="font-sans antialiased text-gray-900 bg-gray-50">
        <ClientShell>
          {children}
        </ClientShell>
      </body>
    </html>
  );
}
"""
    with open(layout_path, "w") as f:
        f.write(layout_code)

    print("Refinamientos aplicados con éxito.")

if __name__ == "__main__":
    main()
