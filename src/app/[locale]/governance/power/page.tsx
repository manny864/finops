import MockBanner from '@/components/MockBanner';
import PowerSchedules from "@/components/dashboard/PowerSchedules";
import { getTranslations } from 'next-intl/server';

export default async function PowerPage() {
  const t = await getTranslations('Navigation');
  return (
    <div className="p-6">
      <MockBanner />
      <h1 className="text-2xl font-bold mb-4">{t('power_schedules')}</h1>
      <PowerSchedules />
    </div>
  );
}
