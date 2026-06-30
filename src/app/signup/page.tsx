import { redirect } from 'next/navigation';
import { getLocale } from '@/i18n/request';

export default async function SignupRedirect() {
  const locale = await getLocale();
  redirect(`/${locale}/signup`);
}
