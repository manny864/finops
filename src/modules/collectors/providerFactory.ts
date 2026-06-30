import { CloudProvider } from './types';
import { AzureProvider } from './azureProvider';
import { AwsProvider } from './aws/awsProvider';

/**
 * Factory pattern to instantiate the appropriate Cloud Provider engine.
 * Defaults to Azure, but resolves AWS when providerName='aws'.
 */
export async function getCloudProvider(tenantId: string, providerName: string = 'azure'): Promise<CloudProvider> {
    switch (providerName.toLowerCase()) {
        case 'azure':
            return new AzureProvider();
        case 'aws':
            return new AwsProvider();
        // case 'gcp': return new GCPProvider();
        default:
            throw new Error(`Cloud provider ${providerName} is not currently supported.`);
    }
}
