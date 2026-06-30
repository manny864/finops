import { generateSecret as otplibGenerateSecret, generateURI, verify as otplibVerify } from 'otplib';
import QRCode from 'qrcode';

const ISSUER = 'FinOps SaaS';

/**
 * Generates a new TOTP secret with QR code
 * Returns: { secret, otpauth_url, qrCodeDataUrl }
 */
export async function generateSecret(email: string): Promise<{
  secret: string;
  otpauth_url: string;
  qrCodeDataUrl: string;
}> {
  const secret = otplibGenerateSecret();
  const otpauth_url = generateURI({
    label: email,
    issuer: ISSUER,
    secret: secret,
  });
  const qrCodeDataUrl = await QRCode.toDataURL(otpauth_url);

  return {
    secret,
    otpauth_url,
    qrCodeDataUrl,
  };
}

/**
 * Verifies a TOTP token
 * Allows ±30s drift (window: 1)
 * Token must be exactly 6 digits
 */
export function verifyToken(secret: string, token: string): boolean {
  try {
    // Validate token format first
    if (!token || typeof token !== 'string' || token.length !== 6 || !/^\d+$/.test(token)) {
      return false;
    }

    const result = otplibVerify({
      secret,
      encoding: 'base32',
      token,
      window: 1, // Allow ±30s drift
    });
    return result !== false;
  } catch {
    return false;
  }
}
