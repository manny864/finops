import fs from 'fs';
import path from 'path';

const configPath = path.join(process.cwd(), 'config', 'payment.json');

export interface PaymentConfig {
  LEMON_SQUEEZY_API_KEY: string;
  LEMON_SQUEEZY_STORE_ID: string;
  LEMON_SQUEEZY_PRO_VARIANT_ID: string;
  LEMON_SQUEEZY_BUSINESS_VARIANT_ID: string;
  LEMON_SQUEEZY_WEBHOOK_SECRET: string;
}

const defaultConfig: PaymentConfig = {
  LEMON_SQUEEZY_API_KEY: "",
  LEMON_SQUEEZY_STORE_ID: "",
  LEMON_SQUEEZY_PRO_VARIANT_ID: "",
  LEMON_SQUEEZY_BUSINESS_VARIANT_ID: "",
  LEMON_SQUEEZY_WEBHOOK_SECRET: ""
};

export function getPaymentConfig(): PaymentConfig {
  try {
    if (!fs.existsSync(configPath)) {
      return defaultConfig;
    }
    const fileContent = fs.readFileSync(configPath, 'utf8');
    return { ...defaultConfig, ...JSON.parse(fileContent) };
  } catch (err) {
    console.error("Error reading payment config:", err);
    return defaultConfig;
  }
}

export function savePaymentConfig(config: Partial<PaymentConfig>): void {
  try {
    const dir = path.dirname(configPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const currentConfig = getPaymentConfig();
    const newConfig = { ...currentConfig, ...config };
    fs.writeFileSync(configPath, JSON.stringify(newConfig, null, 2), 'utf8');
  } catch (err) {
    console.error("Error saving payment config:", err);
    throw new Error("Failed to save configuration");
  }
}
