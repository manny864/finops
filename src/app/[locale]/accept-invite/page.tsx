import { Suspense } from 'react';
import AuthTokenPageClient from '@/components/AuthTokenPageClient';

export const metadata = { title: 'Activar cuenta - CSCloudSolutions' };

export default function AcceptInvitePage() {
    return (
        <Suspense fallback={null}>
            <AuthTokenPageClient mode="invite" />
        </Suspense>
    );
}
