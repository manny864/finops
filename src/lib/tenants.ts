export interface Tenant {
  id: string;
  name: string;
  tier?: 'Essential' | 'Professional' | 'Business' | 'Enterprise';
  subscriptionId?: string;
  subscriptionStatus?: 'active' | 'past_due' | 'canceled' | 'trialing' | 'unpaid';
  trialEndsAt?: string;
}

export const tenants: Tenant[] = [
  {
    id: "54d7cf18-0baa-4da7-8242-fbf59a92aaac",
    name: "CSCloudSolutions Global (Admin)",
    tier: 'Enterprise'
  },
  {
    id: "11111111-2222-3333-4444-555555555555",
    name: "Cliente Acme (Demo Free)",
    tier: 'Essential'
  },
  {
    id: "22222222-3333-4444-5555-666666666666",
    name: "Startup Tech (Demo Pro)",
    tier: 'Professional'
  },
  {
    id: "44444444-5555-6666-7777-888888888888",
    name: "Midmarket Corp (Demo Business)",
    tier: 'Business'
  },
  {
    id: "33333333-4444-5555-6666-777777777777",
    name: "Corporacion XYZ (Demo Enterprise)",
    tier: 'Enterprise'
  }
];
