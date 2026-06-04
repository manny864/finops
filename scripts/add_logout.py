import os

def main():
    base_dir = "/Users/manuelchavez/Documents/FinOpsProyect"
    auth_path = os.path.join(base_dir, "src", "components", "AuthProvider.tsx")
    
    with open(auth_path, "r") as f:
        content = f.read()

    # Inyectar el hook useIsAuthenticated en los imports si no existe
    if "useIsAuthenticated" not in content:
        content = content.replace(
            'import { MsalProvider, useMsal } from "@azure/msal-react";',
            'import { MsalProvider, useMsal, useIsAuthenticated } from "@azure/msal-react";'
        )

    # Reemplazar la función AuthButton con la nueva lógica
    old_auth_button = """export function AuthButton() {
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
}"""

    new_auth_button = """export function AuthButton() {
    const { instance, accounts, inProgress } = useMsal();
    const isAuthenticated = useIsAuthenticated();

    const handleLogin = () => {
        instance.loginRedirect({
            scopes: ["User.Read", "Directory.Read.All"]
        }).catch(e => console.error("Error al iniciar loginRedirect:", e));
    };

    const handleLogout = () => {
        instance.logoutRedirect({
            postLogoutRedirectUri: typeof window !== "undefined" ? window.location.origin : "/"
        }).catch(e => console.error("Error al iniciar logout:", e));
    };

    if (isAuthenticated && accounts.length > 0) {
        return (
            <div className="flex items-center space-x-4 px-3">
                <div className="flex items-center space-x-3">
                    <div className="w-9 h-9 rounded-full bg-[var(--color-primary)] flex items-center justify-center text-white font-bold shadow-sm">
                        {accounts[0].name?.charAt(0) || "U"}
                    </div>
                    <div className="hidden md:block">
                        <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">{accounts[0].name}</p>
                        <p className="text-xs text-gray-500">{accounts[0].username}</p>
                    </div>
                </div>
                <button 
                    onClick={handleLogout}
                    className="text-xs font-semibold text-red-600 hover:text-red-800 transition-colors border border-red-200 dark:border-red-900/50 bg-red-50 hover:bg-red-100 dark:bg-red-900/10 dark:hover:bg-red-900/30 px-3 py-1.5 rounded-md"
                >
                    Cerrar Sesión
                </button>
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
}"""

    if old_auth_button in content:
        content = content.replace(old_auth_button, new_auth_button)
        with open(auth_path, "w") as f:
            f.write(content)
        print("Botón Cerrar Sesión y renderizado condicional inyectados correctamente en AuthProvider.tsx")
    else:
        print("Error: No se pudo encontrar el bloque AuthButton original para reemplazar.")

if __name__ == "__main__":
    main()
