import { headers } from 'next/headers';
import { routing } from './routing';

export async function getLocale() {
  const headersList = await headers();
  const pathname = headersList.get('x-pathname') || '/';
  
  // Extract locale from pathname like /en/... or /es/...
  const segments = pathname.split('/').filter(Boolean);
  const locale = segments[0];
  
  if (routing.locales.includes(locale as any)) {
    return locale;
  }
  
  return routing.defaultLocale;
}
