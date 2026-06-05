import os
import shutil
import subprocess

base_dir = "/Users/manuelchavez/Documents/FinOpsProyect"

def deploy():
    # 1. Create SOP
    print("Creando directiva...")
    os.makedirs(os.path.join(base_dir, "directivas"), exist_ok=True)
    sop_path = os.path.join(base_dir, "directivas/i18n_setup_SOP.md")
    with open(sop_path, "w") as f:
        f.write("# i18n Setup SOP (Next-Intl)\\n\\n")
        f.write("## Objetivo\\nSoportar múltiples idiomas (EN, ES, PT-BR) en la plataforma App Router mediante `next-intl`.\\n\\n")
        f.write("## Restricciones/Casos Borde\\n- Todas las rutas (excepto API) deben ubicarse dentro de `[locale]`.\\n- `middleware.ts` requiere excluir las rutas estáticas y `/api`.\\n")

    # 2. Create Messages Dictionaries
    print("Creando Diccionarios JSON...")
    messages_dir = os.path.join(base_dir, "messages")
    os.makedirs(messages_dir, exist_ok=True)
    
    es_dict = '''{
  "Navigation": {
    "dashboard": "Dashboard",
    "advisor": "Azure Advisor",
    "finops_maturity": "Madurez FinOps",
    "historical_progress": "Progreso Histórico",
    "billing": "Consumo Real",
    "rightsizing": "Rightsizing",
    "network_analytics": "Análisis de Red",
    "vm_control": "Control de VM"
  },
  "Common": {
    "save": "Guardar",
    "deploy": "Desplegar",
    "cancel": "Cancelar",
    "analyze": "Analizar",
    "loading": "Cargando..."
  }
}'''
    en_dict = '''{
  "Navigation": {
    "dashboard": "Dashboard",
    "advisor": "Azure Advisor",
    "finops_maturity": "FinOps Maturity",
    "historical_progress": "Historical Progress",
    "billing": "Actual Usage",
    "rightsizing": "Rightsizing",
    "network_analytics": "Network Analytics",
    "vm_control": "VM Control"
  },
  "Common": {
    "save": "Save",
    "deploy": "Deploy",
    "cancel": "Cancel",
    "analyze": "Analyze",
    "loading": "Loading..."
  }
}'''
    pt_dict = '''{
  "Navigation": {
    "dashboard": "Painel de Controle",
    "advisor": "Consultor Azure",
    "finops_maturity": "Maturidade FinOps",
    "historical_progress": "Progresso Histórico",
    "billing": "Consumo Real",
    "rightsizing": "Dimensionamento Ideal",
    "network_analytics": "Análise de Rede",
    "vm_control": "Controle de VM"
  },
  "Common": {
    "save": "Salvar",
    "deploy": "Implantar",
    "cancel": "Cancelar",
    "analyze": "Analisar",
    "loading": "Carregando..."
  }
}'''
    with open(os.path.join(messages_dir, "es.json"), "w") as f: f.write(es_dict)
    with open(os.path.join(messages_dir, "en.json"), "w") as f: f.write(en_dict)
    with open(os.path.join(messages_dir, "pt-BR.json"), "w") as f: f.write(pt_dict)

    # 3. Middleware
    print("Creando Middleware...")
    middleware_path = os.path.join(base_dir, "src/middleware.ts")
    with open(middleware_path, "w") as f:
        f.write("""import createMiddleware from 'next-intl/middleware';

export default createMiddleware({
  locales: ['en', 'es', 'pt-BR'],
  defaultLocale: 'es'
});

export const config = {
  // Skip all paths that should not be internationalized
  matcher: ['/((?!api|_next|.*\\\\..*).*)']
};
""")

    # 4. i18n config
    print("Creando config i18n...")
    i18n_path = os.path.join(base_dir, "src/i18n.ts")
    with open(i18n_path, "w") as f:
        f.write("""import { getRequestConfig } from 'next-intl/server';
import { notFound } from 'next/navigation';

const locales = ['en', 'es', 'pt-BR'];

export default getRequestConfig(async ({ locale }) => {
  if (!locales.includes(locale as any)) notFound();

  return {
    messages: (await import(`../messages/${locale}.json`)).default
  };
});
""")

    # 5. next.config.ts wrapper
    print("Actualizando next.config.ts...")
    next_config_path = os.path.join(base_dir, "next.config.ts")
    if os.path.exists(next_config_path):
        with open(next_config_path, "r") as f:
            nc_content = f.read()
        
        if "withNextIntl" not in nc_content:
            nc_content = """import createNextIntlPlugin from 'next-intl/plugin';\\nconst withNextIntl = createNextIntlPlugin('./src/i18n.ts');\\n\\n""" + nc_content
            nc_content = nc_content.replace("export default nextConfig;", "export default withNextIntl(nextConfig);")
            with open(next_config_path, "w") as f:
                f.write(nc_content)

    # 6. LanguageSwitcher Component
    print("Creando LanguageSwitcher UI...")
    components_dir = os.path.join(base_dir, "src/components")
    switcher_path = os.path.join(components_dir, "LanguageSwitcher.tsx")
    with open(switcher_path, "w") as f:
        f.write(""""use client";
import { useLocale } from 'next-intl';
import { useRouter, usePathname } from 'next/navigation';
import { ChangeEvent, useTransition } from 'react';
import { Globe } from 'lucide-react';

export default function LanguageSwitcher() {
  const [isPending, startTransition] = useTransition();
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();

  const onSelectChange = (e: ChangeEvent<HTMLSelectElement>) => {
    const nextLocale = e.target.value;
    startTransition(() => {
      // Basic approach: replace the locale part in the URL.
      // Next.js standard router is used here, but typically next-intl/navigation is preferred.
      const pathWithoutLocale = pathname.replace(`/${locale}`, '');
      router.replace(`/${nextLocale}${pathWithoutLocale}`);
    });
  };

  return (
    <div className="flex items-center text-sm mr-4">
      <Globe className="w-4 h-4 mr-1 text-gray-500" />
      <select 
        defaultValue={locale}
        onChange={onSelectChange}
        disabled={isPending}
        className="bg-transparent border-none text-gray-700 dark:text-gray-200 focus:ring-0 cursor-pointer outline-none font-medium"
      >
        <option value="es">🇪🇸 ES</option>
        <option value="en">🇺🇸 EN</option>
        <option value="pt-BR">🇧🇷 PT-BR</option>
      </select>
    </div>
  );
}
""")

    # 7. Update ClientShell
    print("Inyectando LanguageSwitcher en ClientShell...")
    shell_path = os.path.join(components_dir, "ClientShell.tsx")
    with open(shell_path, "r") as f:
        shell_content = f.read()

    if "LanguageSwitcher" not in shell_content:
        shell_content = shell_content.replace(
            "import AuthSync from './AuthSync';",
            "import AuthSync from './AuthSync';\\nimport LanguageSwitcher from './LanguageSwitcher';"
        )
        shell_content = shell_content.replace(
            "<AuthButton />",
            "<LanguageSwitcher />\\n            <AuthButton />"
        )
        with open(shell_path, "w") as f:
            f.write(shell_content)

    # 8. Refactor Routing to [locale]
    print("Reubicando rutas dentro de [locale]...")
    app_dir = os.path.join(base_dir, "src/app")
    locale_dir = os.path.join(app_dir, "[locale]")
    os.makedirs(locale_dir, exist_ok=True)
    
    routes_to_move = ['admin', 'advisor', 'cleanup', 'governance', 'intelligence', 'overview', 'layout.tsx', 'page.tsx']
    for r in routes_to_move:
        src = os.path.join(app_dir, r)
        dst = os.path.join(locale_dir, r)
        if os.path.exists(src) and not os.path.exists(dst):
            shutil.move(src, dst)

    # 9. Update layout.tsx imports and RootLayout
    print("Ajustando layout.tsx...")
    layout_path = os.path.join(locale_dir, "layout.tsx")
    if os.path.exists(layout_path):
        with open(layout_path, "r") as f:
            layout_content = f.read()
        
        layout_content = layout_content.replace('import "./globals.css";', 'import "../globals.css";')
        
        if "NextIntlClientProvider" not in layout_content:
            layout_content = layout_content.replace(
                "import { ThemeProvider } from \\\"@/components/ThemeProvider\\\";",
                "import { NextIntlClientProvider } from 'next-intl';\\nimport { getMessages } from 'next-intl/server';\\nimport { ThemeProvider } from \\\"@/components/ThemeProvider\\\";"
            )
            
            layout_content = layout_content.replace(
                "export default function RootLayout({",
                "export default async function RootLayout({"
            )
            layout_content = layout_content.replace(
                "}: Readonly<{",
                "  params: { locale },\\n}: Readonly<{"
            )
            layout_content = layout_content.replace(
                "  children: React.ReactNode;",
                "  children: React.ReactNode;\\n  params: { locale: string };"
            )
            
            # Wrap ThemeProvider with NextIntlClientProvider
            layout_content = layout_content.replace(
                "  return (\\n    <html lang=\\\"es\\\"",
                "  const messages = await getMessages();\\n\\n  return (\\n    <html lang={locale}"
            )
            layout_content = layout_content.replace(
                "<ThemeProvider",
                "<NextIntlClientProvider messages={messages}>\\n          <ThemeProvider"
            )
            layout_content = layout_content.replace(
                "</ThemeProvider>",
                "</ThemeProvider>\\n        </NextIntlClientProvider>"
            )
            
            with open(layout_path, "w") as f:
                f.write(layout_content)

    print("Deploy script finished.")

if __name__ == "__main__":
    deploy()
