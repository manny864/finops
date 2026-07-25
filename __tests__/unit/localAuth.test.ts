// @vitest-environment node
//
// jose valida `payload instanceof Uint8Array`, y el Uint8Array que produce el
// TextEncoder de jsdom viene de otro realm: falla el instanceof aunque el
// contenido sea idéntico. Este código sólo corre server-side, así que el
// entorno node es además el fiel al runtime real.
import { describe, it, expect, beforeAll } from 'vitest';
import { SignJWT } from 'jose';
import {
  issueLocalToken,
  verifyLocalToken,
  isLocalAuthConfigured,
  LOCAL_TOKEN_ISSUER,
} from '@/lib/localToken';
import {
  validatePasswordPolicy,
  hashPassword,
  verifyPassword,
  verifyPasswordConstantTime,
  normalizeEmail,
  PASSWORD_MIN_LENGTH,
} from '@/lib/localAuth';

const SECRET = 'test-secret-de-al-menos-32-caracteres-para-hs256';

beforeAll(() => {
  process.env.LOCAL_AUTH_SECRET = SECRET;
});

describe('localToken — emisión y verificación', () => {
  it('ida y vuelta: los claims salen con la forma de un idToken de Entra', async () => {
    const token = await issueLocalToken({
      tid: 'tenant-uuid-1',
      oid: 'local:42',
      email: 'user@example.com',
    });

    const claims = await verifyLocalToken(token);
    // Estos tres claims son el contrato con requireRequestIdentity.
    expect(claims.tid).toBe('tenant-uuid-1');
    expect(claims.oid).toBe('local:42');
    expect(claims.email).toBe('user@example.com');
    expect(claims.iss).toBe(LOCAL_TOKEN_ISSUER);
  });

  it('rechaza un token firmado con otro secreto', async () => {
    const forged = await new SignJWT({ email: 'attacker@example.com' })
      .setProtectedHeader({ alg: 'HS256' })
      .setAudience('tenant-victima')
      .setIssuer(LOCAL_TOKEN_ISSUER)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode('otro-secreto-de-32-caracteres-aaaaaa'));

    await expect(verifyLocalToken(forged)).rejects.toThrow();
  });

  it('rechaza un token con issuer ajeno aunque la firma sea válida', async () => {
    const wrongIssuer = await new SignJWT({ email: 'user@example.com' })
      .setProtectedHeader({ alg: 'HS256' })
      .setAudience('tenant-uuid-1')
      .setIssuer('https://login.microsoftonline.com/algo/v2.0')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode(SECRET));

    await expect(verifyLocalToken(wrongIssuer)).rejects.toThrow();
  });

  it('rechaza un token vencido', async () => {
    const expired = await new SignJWT({ email: 'user@example.com' })
      .setProtectedHeader({ alg: 'HS256' })
      .setAudience('tenant-uuid-1')
      .setIssuer(LOCAL_TOKEN_ISSUER)
      .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
      .sign(new TextEncoder().encode(SECRET));

    await expect(verifyLocalToken(expired)).rejects.toThrow();
  });

  it('rechaza un token sin audience (sin tenant no hay identidad posible)', async () => {
    const noAud = await new SignJWT({ email: 'user@example.com' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer(LOCAL_TOKEN_ISSUER)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode(SECRET));

    await expect(verifyLocalToken(noAud)).rejects.toThrow(/sin tenant/i);
  });

  it('falla cerrado si LOCAL_AUTH_SECRET no está configurado o es corto', async () => {
    const original = process.env.LOCAL_AUTH_SECRET;
    try {
      delete process.env.LOCAL_AUTH_SECRET;
      expect(isLocalAuthConfigured()).toBe(false);
      await expect(issueLocalToken({ tid: 't', oid: 'o', email: 'e' })).rejects.toThrow(/LOCAL_AUTH_SECRET/);

      process.env.LOCAL_AUTH_SECRET = 'corto';
      expect(isLocalAuthConfigured()).toBe(false);
      await expect(issueLocalToken({ tid: 't', oid: 'o', email: 'e' })).rejects.toThrow(/LOCAL_AUTH_SECRET/);
    } finally {
      process.env.LOCAL_AUTH_SECRET = original;
    }
  });
});

describe('localAuth — contraseñas', () => {
  it('exige el mínimo de longitud y no impone reglas de composición', () => {
    expect(validatePasswordPolicy('a'.repeat(PASSWORD_MIN_LENGTH - 1))).toBeTruthy();
    expect(validatePasswordPolicy('a'.repeat(PASSWORD_MIN_LENGTH))).toBeNull();
    // Una passphrase sin símbolos ni mayúsculas es válida a propósito.
    expect(validatePasswordPolicy('caballo correcto grapa pila')).toBeNull();
    expect(validatePasswordPolicy('x'.repeat(201))).toBeTruthy();
  });

  it('hashea y verifica', async () => {
    const hash = await hashPassword('una-contraseña-larga-y-valida');
    expect(hash).not.toContain('una-contraseña');
    expect(await verifyPassword('una-contraseña-larga-y-valida', hash)).toBe(true);
    expect(await verifyPassword('otra-cosa-completamente', hash)).toBe(false);
  });

  it('con hash nulo devuelve false pero igual gasta un bcrypt (anti timing)', async () => {
    const start = Date.now();
    expect(await verifyPasswordConstantTime('lo-que-sea-largo-aca', null)).toBe(false);
    // bcrypt con coste 12 no baja de ~50ms ni en hardware rápido; si esto
    // volviera instantáneo significa que el hash dummy dejó de ser válido y
    // el endpoint de login volvió a filtrar qué emails existen.
    expect(Date.now() - start).toBeGreaterThan(20);
  });
});

describe('localAuth — normalización de email', () => {
  it('recorta y baja a minúsculas para que el login no dependa del tipeo', () => {
    expect(normalizeEmail('  User@Example.COM ')).toBe('user@example.com');
    expect(normalizeEmail('')).toBe('');
  });
});
