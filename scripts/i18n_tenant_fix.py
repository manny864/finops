import os

base_dir = "/Users/manuelchavez/Documents/FinOpsProyect"

def deploy():
    print("1. Creando Directiva SOP...")
    os.makedirs(os.path.join(base_dir, "directivas"), exist_ok=True)
    sop_path = os.path.join(base_dir, "directivas/i18n_tenant_fix_SOP.md")
    with open(sop_path, "w") as f:
        f.write("# i18n & Tenant State Fix SOP\\n\\n")
        f.write("## Objetivo\\n1. Persistir el `selectedTenant` en `localStorage` para sobrevivir transiciones de ruta causadas por el cambio de idioma.\\n")
        f.write("2. Mejorar `LanguageSwitcher.tsx` para que retenga parámetros de búsqueda (searchParams) y no corte la URL.\\n")
        f.write("3. Colocar el `LanguageSwitcher` en el layout de Login para accesibilidad internacional.\\n\\n")
        f.write("## Restricciones/Casos Borde\\n- **Nota**: El `useSearchParams` debe ser importado de `next/navigation`. El `TenantProvider` debe hidratar el estado del tenant inicial si existe en el `localStorage`.\\n")

    print("2. Parcheando TenantProvider.tsx...")
    tenant_path = os.path.join(base_dir, "src/components/TenantProvider.tsx")
    with open(tenant_path, "r") as f:
        tenant_content = f.read()

    if "finops_active_tenant" not in tenant_content:
        # Initialize state from localStorage
        init_state = """  const [selectedTenant, setSelectedTenant] = useState<Tenant>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('finops_active_tenant');
      if (saved) {
        try { return JSON.parse(saved); } catch(e) {}
      }
    }
    return { id: 'default', name: 'Cargando entornos...' };
  });

  // Sync to localStorage
  useEffect(() => {
    if (selectedTenant.id !== 'default') {
      localStorage.setItem('finops_active_tenant', JSON.stringify(selectedTenant));
    }
  }, [selectedTenant]);"""

        tenant_content = tenant_content.replace(
            "  const [selectedTenant, setSelectedTenant] = useState<Tenant>(tenantsList[0]);",
            init_state
        )

        # Skip fallback logic if tenant is NOT default
        fallback_logic = """      // Lógica de fallback robusta
      if (selectedTenant.id === 'default') {"""
        new_fallback_logic = """      // Lógica de fallback robusta si no hay nada en localStorage
      if (selectedTenant.id === 'default') {"""
        tenant_content = tenant_content.replace(fallback_logic, new_fallback_logic)

        with open(tenant_path, "w") as f:
            f.write(tenant_content)


    print("3. Parcheando LanguageSwitcher.tsx...")
    lang_path = os.path.join(base_dir, "src/components/LanguageSwitcher.tsx")
    with open(lang_path, "r") as f:
        lang_content = f.read()

    if "useSearchParams" not in lang_content:
        lang_content = lang_content.replace(
            "import { useRouter, usePathname } from 'next/navigation';",
            "import { useRouter, usePathname, useSearchParams } from 'next/navigation';"
        )
        
        lang_content = lang_content.replace(
            "const pathname = usePathname();",
            "const pathname = usePathname();\\n  const searchParams = useSearchParams();"
        )

        old_switch = """      const pathWithoutLocale = pathname.replace(`/${locale}`, '');
      router.replace(`/${nextLocale}${pathWithoutLocale}`);"""
        
        new_switch = """      const pathWithoutLocale = pathname.replace(`/${locale}`, '') || '/';
      const search = searchParams.toString();
      const query = search ? `?${search}` : '';
      router.replace(`/${nextLocale}${pathWithoutLocale}${query}`);"""

        lang_content = lang_content.replace(old_switch, new_switch)

        with open(lang_path, "w") as f:
            f.write(lang_content)


    print("4. Parcheando ClientShell.tsx (Login view)...")
    shell_path = os.path.join(base_dir, "src/components/ClientShell.tsx")
    with open(shell_path, "r") as f:
        shell_content = f.read()

    if "absolute top-4 right-4 z-50" not in shell_content:
        login_view = """      return (
          <div className="min-h-screen bg-[#FFFFFF] flex flex-col justify-center py-12 sm:px-6 lg:px-8" style={{ fontFamily: 'var(--font-opensans), sans-serif' }}>
              <div className="sm:mx-auto sm:w-full sm:max-w-md text-center animate-in fade-in zoom-in duration-500">"""
              
        new_login_view = """      return (
          <div className="min-h-screen bg-[#FFFFFF] flex flex-col justify-center py-12 sm:px-6 lg:px-8 relative" style={{ fontFamily: 'var(--font-opensans), sans-serif' }}>
              <div className="absolute top-4 right-4 z-50">
                  <LanguageSwitcher />
              </div>
              <div className="sm:mx-auto sm:w-full sm:max-w-md text-center animate-in fade-in zoom-in duration-500">"""
              
        shell_content = shell_content.replace(login_view, new_login_view)
        
        with open(shell_path, "w") as f:
            f.write(shell_content)

    print("Script completado.")

if __name__ == "__main__":
    deploy()
