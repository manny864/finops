export interface Tenant {
  id: string;
  name: string;
  tier?: 'Essential' | 'Professional' | 'Business' | 'Enterprise';
  subscriptionId?: string;
  subscriptionStatus?: 'active' | 'past_due' | 'canceled' | 'trialing' | 'unpaid';
  trialEndsAt?: string;
  /**
   * Proveedor de nube del tenant de demo. Mocks por tier (directiva #13):
   * 'both' solo en Enterprise, que es el unico plan con multi-cloud, para que
   * /demo muestre el switch AWS/Azure con el tier correspondiente.
   */
  provider?: 'azure' | 'aws' | 'both';
}

export const tenants: Tenant[] = [
  {
    id: "11111111-2222-3333-4444-555555555555",
    name: "Cliente Acme (Demo Essential)",
    tier: 'Essential',
    provider: 'azure'
  },
  {
    id: "22222222-3333-4444-5555-666666666666",
    name: "Startup Tech (Demo Pro)",
    tier: 'Professional',
    provider: 'azure'
  },
  {
    id: "44444444-5555-6666-7777-888888888888",
    name: "Midmarket Corp (Demo Business)",
    tier: 'Business',
    provider: 'azure'
  },
  {
    id: "33333333-4444-5555-6666-777777777777",
    name: "Corporacion XYZ (Demo Enterprise)",
    tier: 'Enterprise',
    provider: 'both'
  }
];
