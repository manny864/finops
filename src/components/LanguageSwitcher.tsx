"use client";
import { useLocale } from 'next-intl';
import { useRouter, usePathname } from '@/i18n/routing';
import { useSearchParams } from 'next/navigation';
import { ChangeEvent, CSSProperties, useTransition } from 'react';
import { Globe } from 'lucide-react';

interface LanguageSwitcherProps {
  className?: string;
  selectClassName?: string;
  iconClassName?: string;
  // Estilos inline para el <select> (p.ej. forzar color: #fff). Se aplica inline
  // a propósito: una regla global `select { color: var(--ink) }` (sin @layer) gana
  // sobre las utilities `text-*` de Tailwind, y no podemos usar !important porque
  // rompe el render nativo del popup en macOS (ver globals.css). Inline no-important
  // gana por especificidad sin tocar el popup, que sigue guiado por color-scheme.
  selectStyle?: CSSProperties;
}

export default function LanguageSwitcher({ className, selectClassName, iconClassName, selectStyle }: LanguageSwitcherProps = {}) {
  const [isPending, startTransition] = useTransition();
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  // useSearchParams is still needed from next/navigation
  const searchParams = useSearchParams();

  const onSelectChange = (e: ChangeEvent<HTMLSelectElement>) => {
    const nextLocale = e.target.value;
    startTransition(() => {
      // Preserve search params
      const search = searchParams.toString();
      const query = search ? `?${search}` : '';
      
      // Use next-intl's router for 100% SPA navigation
      router.replace(`${pathname}${query}` as any, { locale: nextLocale });
    });
  };

  return (
    <div className={className ?? "flex items-center text-sm mr-4"}>
      <Globe className={iconClassName ?? "w-4 h-4 mr-1 text-gray-500 shrink-0"} />
      <select
        defaultValue={locale}
        onChange={onSelectChange}
        disabled={isPending}
        style={selectStyle}
        className={selectClassName ?? "bg-transparent border-none text-gray-700 dark:text-gray-200 focus:ring-0 cursor-pointer outline-none font-medium dark:bg-slate-800 dark:border-slate-700 dark:text-white placeholder-gray-500 dark:placeholder-gray-400"}
      >
        <option value="es">🇪🇸 ES</option>
        <option value="en">🇺🇸 EN</option>
        <option value="pt-BR">🇧🇷 PT-BR</option>
      </select>
    </div>
  );
}
