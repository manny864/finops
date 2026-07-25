import { Suspense } from 'react';
import AuthTokenPageClient from '@/components/AuthTokenPageClient';

export const metadata = { title: 'Restablecer contraseña - CSCloudSolutions' };

export default function ResetPasswordPage() {
    return (
        <Suspense fallback={null}>
            <AuthTokenPageClient mode="reset" />
        </Suspense>
    );
}
