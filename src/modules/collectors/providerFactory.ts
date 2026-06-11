import { CloudProvider } from './types';
import { AzureProvider } from './azureProvider';

/**
 * Factory pattern to instantiate the appropriate Cloud Provider engine.
 * Currently defaults to Azure, but built to dynamically resolve based on tenant credentials.
 */
export async function getCloudProvider(tenantId: string, providerName: string = 'azure'): Promise<CloudProvider> {
    switch (providerName.toLowerCase()) {
        case 'azure':
            return new AzureProvider();
        // case 'aws': return new AWSProvider();
        // case 'gcp': return new GCPProvider();
        default:
            throw new Error(`Cloud provider ${providerName} is not currently supported.`);
    }
}
