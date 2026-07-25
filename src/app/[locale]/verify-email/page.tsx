import { Suspense } from 'react';
import AuthTokenPageClient from '@/components/AuthTokenPageClient';

export const metadata = { title: 'Confirmar email - CSCloudSolutions' };

export default function VerifyEmailPage() {
    // useSearchParams exige Suspense en el App Router, si no falla el build.
    return (
        <Suspense fallback={null}>
            <AuthTokenPageClient mode="verify" />
        </Suspense>
    );
}
