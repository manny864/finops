"use client";
import React, { ReactNode, useEffect, useState, createContext, useContext } from "react";
import { PublicClientApplication, EventType, AuthenticationResult } from "@azure/msal-browser";
import { MsalProvider, useMsal, useIsAuthenticated } from "@azure/msal-react";
import { useTenant } from "./TenantProvider";
import { isMockTenant } from "@/lib/mockData";
import { exitDemoSession } from "@/app/_actions/demoAuth";
import UserProfileMenu from "./UserProfileMenu";

const pca = new PublicClientApplication({
    auth: {
        clientId: process.env.NEXT_PUBLIC_CLIENT_ID || "not-configured",
        authority: "https://login.microsoftonline.com/common",
        redirectUri: typeof window !== "undefined" ? window.location.origin : "/",
    }
});

export const AuthLoadingContext = createContext({ isInitializing: true });
export const useAuthLoading = () => useContext(AuthLoadingContext);

export function AuthButton() {
    const { instance, accounts, inProgress } = useMsal();
    const isAuthenticated = useIsAuthenticated();
    const { selectedTenant } = useTenant();

    const handleLogin = () => {
        instance.loginRedirect({
            scopes: ["User.Read", "Directory.Read.All"]
        }).catch(e => console.error("Error al iniciar loginRedirect:", e));
    };

    if (isAuthenticated && accounts.length > 0) {
        // Solo el avatar: nombre, email, rol, moneda, aspecto y logout viven
        // dentro del menú de perfil (en móvil el botón de logout separado
        // quedaba fuera de pantalla).
        return <UserProfileMenu />;
    }

    if (inProgress === "startup" || inProgress === "handleRedirect") {
        return <span className="text-gray-400 text-sm font-medium animate-pulse px-4">Validando sesión...</span>;
    }

    if (selectedTenant && isMockTenant(selectedTenant.id)) {
        return (
            <button 
                onClick={() => exitDemoSession()}
                className="flex items-center justify-center space-x-2 bg-red-600 hover:bg-red-700 text-white px-5 py-2.5 rounded-lg text-sm font-semibold transition-all shadow-md active:scale-95 w-full"
            >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"></path></svg>
                <span>Salir de la Demo</span>
            </button>
        );
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
                    const accessToken = payload.idToken; // FIX: Se envía el idToken para que el backend pueda extraer los claims 'tid' y 'oid'
                    const pendingPlan = sessionStorage.getItem('pendingUpgrade');
                    
                    console.log("Login exitoso. Ejecutando registro/onboarding en BD silente...");
                    fetch('/api/onboard', {
                        method: 'POST',
                        headers: { 
                            'Authorization': `Bearer ${accessToken}`,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ plan: pendingPlan })
                    }).then(res => res.json()).then(data => {
                        if (data.success) {
                            console.log("Onboarding en Base de Datos exitoso.");
                        } else {
                            console.error("Fallo Onboarding DB:", data.error, data.details);
                        }
                    }).catch(err => console.error("Error Fetch Onboard:", err));
                }
            });

        }).catch(e => {
            console.error("Error inicializando MSAL:", e);
        });
    }, []);

    if (!msalInitialized) {
        return (
            <AuthLoadingContext.Provider value={{ isInitializing: true }}>
                {children}
            </AuthLoadingContext.Provider>
        );
    }

    return (
        <AuthLoadingContext.Provider value={{ isInitializing: false }}>
            <MsalProvider instance={pca}>
                {children}
            </MsalProvider>
        </AuthLoadingContext.Provider>
    );
}
