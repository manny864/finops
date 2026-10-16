export interface PublicRuntimeConfig {
  clientId: string;
  paddleClientToken: string;
  paddleProMonthly: string;
  paddleProYearly: string;
  paddleBusinessMonthly: string;
  paddleBusinessYearly: string;
}

/** Explicit projection only: never serialize process.env or server credentials. */
export function getPublicRuntimeConfig(env: NodeJS.ProcessEnv = process.env): PublicRuntimeConfig {
  return {
    clientId: env.NEXT_PUBLIC_CLIENT_ID || env.NEXT_PUBLIC_AZURE_CLIENT_ID || "876d8a5b-6023-4484-b3ba-73c186e4a72b",
    paddleClientToken: env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN || "",
    paddleProMonthly: env.NEXT_PUBLIC_PADDLE_PRO_MONTHLY || "",
    paddleProYearly: env.NEXT_PUBLIC_PADDLE_PRO_YEARLY || "",
    paddleBusinessMonthly: env.NEXT_PUBLIC_PADDLE_BUSINESS_MONTHLY || "",
    paddleBusinessYearly: env.NEXT_PUBLIC_PADDLE_BUSINESS_YEARLY || "",
  };
}
