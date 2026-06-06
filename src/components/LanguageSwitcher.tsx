"use client";
import { useLocale } from 'next-intl';
import { useRouter, usePathname } from '@/i18n/routing';
import { useSearchParams } from 'next/navigation';
import { ChangeEvent, useTransition } from 'react';
import { Globe } from 'lucide-react';

export default function LanguageSwitcher() {
  const [isPending, startTransition] = useTransition();
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  // useSearchParams is still needed from next/navigation
  const searchParams = useSearchParams();

  const onSelectChange = (e: ChangeEvent<HTMLSelectElement>) => {
    const nextLocale = e.target.value;
    startTransition(() => {
      // Create search params string if any exist
      const search = searchParams.toString();
      const query = search ? `?${search}` : '';
      
      // Use next-intl router to switch language
      router.replace(
          // @ts-ignore
          `${pathname}${query}`, 
          { locale: nextLocale }
      );
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
