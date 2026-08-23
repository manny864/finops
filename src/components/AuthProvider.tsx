"use client";
import React, { ReactNode, useEffect, useState, createContext, useContext } from "react";
import { PublicClientApplication, EventType, AuthenticationResult } from "@azure/msal-browser";
import { MsalProvider, useMsal, useIsAuthenticated } from "@azure/msal-react";
import { useTenant } from "./TenantProvider";
import { isMockTenant } from "@/lib/mockData";
import { exitDemoSession } from "@/app/_actions/demoAuth";
import UserProfileMenu from "./UserProfileMenu";
import { toast } from "sonner";

const pca = new PublicClientApplication({
    auth: {
        clientId:
            process.env.NEXT_PUBLIC_CLIENT_ID ||
            process.env.NEXT_PUBLIC_AZURE_CLIENT_ID ||
            "876d8a5b-6023-4484-b3ba-73c186e4a72b",
        authority: "https://login.microsoftonline.com/common",
        redirectUri: typeof window !== "undefined" ? window.location.origin : "/",
    },
    cache: {
        // Persistir sesión entre pestañas/ventanas del mismo navegador.
        cacheLocation: "localStorage",
    },
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
                className="flex items-center justify-center space-x-2 bg-red-600 hover:bg-red-700 text-white px-3 sm:px-5 py-2.5 rounded-lg text-sm font-semibold transition-all shadow-md active:scale-95 shrink-0"
            >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"></path></svg>
                <span className="hidden lg:inline">Salir de la Demo</span>
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
        let isMounted = true;

        pca.initialize()
            .then(() => {
                // Escuchar eventos de autenticación
                pca.addEventCallback((event) => {
                    if (event.eventType === EventType.LOGIN_SUCCESS && event.payload) {
                        const payload = event.payload as AuthenticationResult;
                        if (payload.account) {
                            pca.setActiveAccount(payload.account);
                        }
                        const accessToken = payload.idToken;
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
                                if (data.error) toast.error(data.error, { duration: 10000 });
                            }
                        }).catch(err => console.error("Error Fetch Onboard:", err));
                    }
                });

                // Manejar respuesta de redirección y restaurar cuenta activa al recargar (F5)
                return pca.handleRedirectPromise();
            })
            .then((authResult) => {
                if (authResult?.account) {
                    pca.setActiveAccount(authResult.account);
                } else if (!pca.getActiveAccount()) {
                    // Restaurar la cuenta guardada en localStorage si no hay cuenta activa asignada
                    const accounts = pca.getAllAccounts();
                    if (accounts.length > 0) {
                        pca.setActiveAccount(accounts[0]);
                    }
                }
                if (isMounted) {
                    setMsalInitialized(true);
                }
            })
            .catch((e) => {
                console.error("Error inicializando MSAL / handleRedirectPromise:", e);
                // Si falla el redirect promise (p.ej. token expirado en URL), intentar restaurar cuenta en cache
                const accounts = pca.getAllAccounts();
                if (accounts.length > 0 && !pca.getActiveAccount()) {
                    pca.setActiveAccount(accounts[0]);
                }
                if (isMounted) {
                    setMsalInitialized(true);
                }
            });

        return () => {
            isMounted = false;
        };
    }, []);

    if (!msalInitialized) {
        return (
            <AuthLoadingContext.Provider value={{ isInitializing: true }}>
                <div className="min-h-screen w-full flex items-center justify-center bg-surface">
                    <div className="flex flex-col items-center gap-3 text-ink-soft animate-pulse">
                        <div className="h-7 w-7 border-2 border-brand-deep border-t-transparent rounded-full animate-spin" />
                        <span className="text-xs font-semibold">Validando sesión...</span>
                    </div>
                </div>
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
