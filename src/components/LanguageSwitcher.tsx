"use client";
import { useLocale } from 'next-intl';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { ChangeEvent, useTransition } from 'react';
import { Globe } from 'lucide-react';

export default function LanguageSwitcher() {
  const [isPending, startTransition] = useTransition();
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const onSelectChange = (e: ChangeEvent<HTMLSelectElement>) => {
    const nextLocale = e.target.value;
    startTransition(() => {
      // Basic approach: replace the locale part in the URL.
      // Next.js standard router is used here, but typically next-intl/navigation is preferred.
      const pathWithoutLocale = pathname.replace(`/${locale}`, '') || '/';
      const search = searchParams.toString();
      const query = search ? `?${search}` : '';
      router.replace(`/${nextLocale}${pathWithoutLocale}${query}`);
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
