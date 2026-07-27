import { CloudProvider } from './types';
import { AzureProvider } from './azureProvider';

/**
 * Factory pattern to instantiate the appropriate Cloud Provider engine.
 * Azure-only product: any other providerName is rejected.
 */
export async function getCloudProvider(tenantId: string, providerName: string = 'azure'): Promise<CloudProvider> {
    switch (providerName.toLowerCase()) {
        case 'azure':
            return new AzureProvider();
        default:
            throw new Error(`Cloud provider ${providerName} is not currently supported.`);
    }
}
