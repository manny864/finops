import { Suspense } from 'react';
import ActivateButton from '@/components/marketplace/ActivateButton';
import { resolveSubscription } from '@/lib/marketplace/azure';
import { azurePlanToTier } from '@/lib/marketplace/planMapping';

interface AzureLandingProps {
  searchParams: Promise<{ token?: string }>;
}

async function resolveSafely(token: string) {
  if (!process.env.AZURE_MARKETPLACE_AAD_APP_ID) {
    return { ok: false as const, error: 'Azure Marketplace not configured (missing AAD_APP_ID)' };
  }
  try {
    const data = await resolveSubscription(token);
    return { ok: true as const, data };
  } catch (error) {
    console.error('Azure token resolution error:', error);
    return { ok: false as const, error: (error as Error).message };
  }
}

function ErrorCard({ message }: { message: string }) {
  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-4">Setup Error</h1>
        <p className="text-gray-600 mb-6">{message}</p>
        <a href="/" className="inline-block w-full text-center px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">
          Return Home
        </a>
      </div>
    </div>
  );
}

async function AzureLandingContent({ token }: { token: string }) {
  const result = await resolveSafely(token);
  if (!result.ok) return <ErrorCard message={result.error} />;

  const subscriptionId = result.data.id || result.data.subscription?.id || '';
  const planId = result.data.planId || result.data.subscription?.planId || '';
  const tier = azurePlanToTier(planId);
  const email =
    result.data.subscription?.beneficiary?.emailId ||
    result.data.subscription?.purchaser?.emailId ||
    '—';

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white">
      <div className="max-w-3xl mx-auto px-4 py-12">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">Welcome to FinOps SaaS Platform</h1>
          <p className="text-xl text-gray-600">From Azure Marketplace</p>
        </div>

        <div className="bg-white rounded-lg shadow-lg p-8 mb-8">
          <h2 className="text-2xl font-bold text-gray-900 mb-6">Subscription Details</h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
            <div className="border-l-4 border-blue-600 pl-4">
              <p className="text-sm font-medium text-gray-500 uppercase tracking-wide">Selected Plan</p>
              <p className="mt-1 text-2xl font-bold text-gray-900">{tier}</p>
              <p className="text-sm text-gray-500 mt-1">{planId}</p>
            </div>
            <div className="border-l-4 border-green-600 pl-4">
              <p className="text-sm font-medium text-gray-500 uppercase tracking-wide">Account Email</p>
              <p className="mt-1 text-lg font-semibold text-gray-900 break-all">{email}</p>
            </div>
          </div>

          <div className="mb-8 text-sm text-gray-600">
            <p>
              Subscription ID: <code className="bg-gray-100 px-2 py-1 rounded">{subscriptionId}</code>
            </p>
          </div>

          <ActivateButton
            endpoint="/api/webhooks/marketplace/azure/activate"
            payload={{ token }}
            label="Activate Subscription"
            color="blue"
          />
        </div>

        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <p className="text-sm text-blue-900">
            <strong>Next Step:</strong> After activation, you&apos;ll complete signup. Your Azure
            Marketplace subscription is already linked to your account.
          </p>
        </div>
      </div>
    </div>
  );
}

export default async function AzureLandingPage({ searchParams }: AzureLandingProps) {
  const params = await searchParams;
  const token = params.token;
  if (!token) return <ErrorCard message="Missing marketplace token. Please return to Azure Marketplace and try again." />;

  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          <div className="text-center">
            <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
            <p className="text-gray-600">Loading subscription details…</p>
          </div>
        </div>
      }
    >
      <AzureLandingContent token={token} />
    </Suspense>
  );
}
