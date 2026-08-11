import MockBanner from '@/components/MockBanner';
import PowerSchedules from "@/components/dashboard/PowerSchedules";
import { getTranslations } from 'next-intl/server';
import { IconClockHour4 } from '@tabler/icons-react';

export default async function PowerPage() {
  const t = await getTranslations('Navigation');
  return (
    <div className="p-6">
      <MockBanner />
      <h1 className="text-2xl font-bold mb-4 flex items-center gap-2">
        <IconClockHour4 className="w-6 h-6 text-brand-deep" />
        {t('power_schedules')}
      </h1>
      <PowerSchedules />
    </div>
  );
}
