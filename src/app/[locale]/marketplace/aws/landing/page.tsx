import { Suspense } from 'react';
import { getTranslations } from 'next-intl/server';
import ActivateButton from '@/components/marketplace/ActivateButton';
import { resolveCustomer, getEntitlements } from '@/lib/marketplace/aws';
import { awsDimensionToTier } from '@/lib/marketplace/planMapping';

interface AwsLandingProps {
  searchParams: Promise<{ 'x-amzn-marketplace-token'?: string; token?: string }>;
}

async function resolveSafely(token: string) {
  const t = await getTranslations('MarketplaceAwsLanding');
  if (!process.env.AWS_MARKETPLACE_PRODUCT_CODE) {
    return { ok: false as const, error: t('errorConfigMissing') };
  }
  try {
    const customer = await resolveCustomer(token);
    let dimension: string | undefined;
    try {
      const ents = await getEntitlements(customer.customerIdentifier, customer.productCode);
      dimension = ents[0]?.Dimension;
    } catch (err) {
      console.warn('AWS getEntitlements warning:', err);
    }
    return { ok: true as const, customer, dimension };
  } catch (error) {
    console.error('AWS token resolution error:', error);
    return { ok: false as const, error: (error as Error).message };
  }
}

async function ErrorCard({ message }: { message: string }) {
  const t = await getTranslations('MarketplaceAwsLanding');
  return (
    <div className="min-h-screen bg-gradient-to-b from-orange-50 to-white flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-4">{t('errorTitle')}</h1>
        <p className="text-gray-600 mb-6">{message}</p>
        <a href="/" className="inline-block w-full text-center px-4 py-2 bg-orange-600 text-white rounded hover:bg-orange-700">
          {t('returnHome')}
        </a>
      </div>
    </div>
  );
}

async function AwsLandingContent({ token }: { token: string }) {
  const t = await getTranslations('MarketplaceAwsLanding');
  const result = await resolveSafely(token);
  if (!result.ok) return <ErrorCard message={result.error} />;

  const tier = awsDimensionToTier(result.dimension);

  return (
    <div className="min-h-screen bg-gradient-to-b from-orange-50 to-white">
      <div className="max-w-3xl mx-auto px-4 py-12">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">{t('welcomeTitle')}</h1>
          <p className="text-xl text-gray-600">{t('welcomeSubtitle')}</p>
        </div>

        <div className="bg-white rounded-lg shadow-lg p-8 mb-8">
          <h2 className="text-2xl font-bold text-gray-900 mb-6">{t('subscriptionDetails')}</h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
            <div className="border-l-4 border-orange-600 pl-4">
              <p className="text-sm font-medium text-gray-500 uppercase tracking-wide">{t('selectedPlan')}</p>
              <p className="mt-1 text-2xl font-bold text-gray-900">{tier}</p>
              <p className="text-sm text-gray-500 mt-1">{result.dimension || t('autoDetected')}</p>
            </div>
            <div className="border-l-4 border-green-600 pl-4">
              <p className="text-sm font-medium text-gray-500 uppercase tracking-wide">{t('awsAccount')}</p>
              <p className="mt-1 text-lg font-semibold text-gray-900 break-all">
                {result.customer.customerAWSAccountId || '—'}
              </p>
            </div>
          </div>

          <div className="mb-8 text-sm text-gray-600">
            <p>
              {t('customerId')} <code className="bg-gray-100 px-2 py-1 rounded">{result.customer.customerIdentifier}</code>
            </p>
            <p className="mt-1">
              {t('productCode')} <code className="bg-gray-100 px-2 py-1 rounded">{result.customer.productCode}</code>
            </p>
          </div>

          <ActivateButton
            endpoint="/api/webhooks/marketplace/aws/activate"
            payload={{ token }}
            label={t('activateButton')}
            color="orange"
          />
        </div>

        <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
          <p className="text-sm text-orange-900">
            <strong>{t('nextStepLabel')}</strong> {t('nextStepText')}
          </p>
        </div>
      </div>
    </div>
  );
}

export default async function AwsLandingPage({ searchParams }: AwsLandingProps) {
  const t = await getTranslations('MarketplaceAwsLanding');
  const params = await searchParams;
  const token = params['x-amzn-marketplace-token'] || params.token;
  if (!token) {
    return (
      <ErrorCard message={t('errorMissingToken')} />
    );
  }

  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          <div className="text-center">
            <div className="w-12 h-12 border-4 border-orange-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
            <p className="text-gray-600">{t('loading')}</p>
          </div>
        </div>
      }
    >
      <AwsLandingContent token={token} />
    </Suspense>
  );
}
