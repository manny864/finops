# 2FA local (TOTP)

Sistema de doble factor por TOTP para usuarios que prefieran no depender de Entra Conditional Access. Funciona en paralelo con WorkOS SSO: si el tenant tiene SSO obligatorio, MFA local sigue siendo opcional para reforzar operaciones críticas.

## Componentes

| Capa | Archivo | Función |
|---|---|---|
| Crypto | `src/lib/mfaCrypto.ts` | AES-256-GCM para secreto, scrypt+random para recovery codes |
| TOTP | `src/lib/mfa.ts` (`otplib`) | `generateSecret`, `verifyToken`, QR base64 |
| Schema | `src/modules/storage/db.ts` (Users +columnas, `MfaChallenges`) | mfa_enabled, mfa_secret_encrypted, mfa_recovery_codes_hash, mfa_last_used_at |
| API enroll | `/api/mfa/enroll/start` `/verify` | Genera QR + 10 recovery codes → guarda → activa al verificar TOTP |
| API disable | `/api/mfa/disable` | Requiere TOTP **o** recovery code válido |
| API challenge | `/api/mfa/challenge` + `/verify-challenge` | Step-up auth para operaciones sensibles |
| API status | `/api/mfa/status` (nuevo) | Devuelve `{enabled, lastUsedAt, recoveryCodesRemaining}` |
| Helper | `src/lib/requireMfaChallenge.ts` | Middleware para forzar step-up en endpoints sensibles (header `X-MFA-Challenge-Id`) |
| UI | `/admin/security` page | Enrollment wizard + recovery codes view + disable modal |
| UI modal | `src/components/MfaPromptModal.tsx` | Prompt TOTP inline cuando llega `mfa_required` desde API |

## Flujo enrollment

1. Usuario va a `/admin/security` → "Enable 2FA".
2. `POST /api/mfa/enroll/start`:
   - Genera secreto random base32, QR data URL, 10 recovery codes plaintext + hashes scrypt.
   - Encripta secreto con AES-256-GCM (clave `MFA_ENCRYPTION_KEY` env).
   - Guarda `mfa_secret_encrypted` y `mfa_recovery_codes_hash` en Users; **NO** prende `mfa_enabled` todavía.
3. Cliente muestra QR + recovery codes + input para código.
4. Usuario escribe TOTP de 6 dígitos.
5. `POST /api/mfa/enroll/verify { token }`:
   - Verifica TOTP con `verifyToken` (window ±30s).
   - Si pasa, prende `mfa_enabled=TRUE` y `mfa_last_used_at=NOW()`.
6. Si el usuario refresca antes de copiar los códigos, los pierde — diseñado así, no se persisten plaintext.

## Flujo step-up (operaciones sensibles)

```
Client → POST /api/sensitive-op
Server: identifica usuario; si mfa_enabled, retorna 403 { code: 'mfa_required', mfa_enrollment_required: false }
Client: MfaPromptModal pide TOTP
Client → POST /api/mfa/challenge { operation: 'sensitive-op', payload }
Server: crea MfaChallenges row con payload_hash, expira en 60s, retorna challengeId
Client → POST /api/mfa/verify-challenge { challengeId, token }
Server: verifica TOTP, marca consumed_at=NOW()
Client → reintenta POST /api/sensitive-op con header X-MFA-Challenge-Id: <id>
Server: requireMfaChallenge() valida challengeId + consumed_at < 60s + payload_hash match
```

`requireMfaChallenge` también valida que el payload no haya cambiado entre el challenge y el reintento (previene confused-deputy).

## Recovery codes

- 10 códigos de 10 caracteres alfanuméricos cada uno.
- Hash scrypt + salt random por código (`generateRecoveryCodes`).
- Al usar uno, se elimina del array y se vuelve a guardar el resto (`verifyRecoveryCode` retorna `{valid, remaining}`).
- UI muestra "Recovery codes remaining: N" en `/admin/security` para que el usuario sepa cuándo regenerar.

## Reset / pérdida del dispositivo

Vía recovery code: `POST /api/mfa/disable { recoveryCode }` lo apaga.
Sin recovery code: SUPERADMIN debe ejecutar manualmente:
```sql
UPDATE Users SET mfa_enabled=FALSE, mfa_secret_encrypted=NULL, mfa_recovery_codes_hash=NULL
WHERE email='user@x' AND tenant_id='t';
```
(TODO Tier 4: panel SUPERADMIN con audit log para esta operación.)

## Variables de entorno

```
MFA_ENCRYPTION_KEY=<base64 32-byte key>   # AES-256-GCM
```

Generar con: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`

En producción, rotación de esta key requiere re-encriptar todos los secretos. Plan: agregar `MFA_ENCRYPTION_KEY_VERSION` y soporte multi-key en `mfaCrypto.ts` (Tier 4).

## Tests

`__tests__/unit/mfa.test.ts` cubre:
- `generateSecret` produce base32 válido
- `verifyToken` válido / inválido / window correcto
- `encryptSecret`/`decryptSecret` round-trip + tamper detection
- `generateRecoveryCodes` produce 10 únicos
- `verifyRecoveryCode` correcto + remove-from-list
- recovery code usado no se puede reusar

## QA manual

1. Setup: `MFA_ENCRYPTION_KEY` en `.env.local`.
2. Login → `/admin/security` → "Enable 2FA".
3. Escanear QR con Google Authenticator / 1Password / Authy.
4. Verificar código → ver mensaje "2FA enabled".
5. Refresh: status debe persistir como Active, lastUsedAt poblado.
6. Test disable sin token: botón deshabilitado.
7. Test disable con código inválido: error.
8. Test disable con código válido: vuelve a Inactive.
9. Re-enroll: recovery codes nuevos se generan, los viejos quedan inválidos.

## Pendientes

- Audit log de enroll/disable/challenge (TODO en `disable/route.ts`).
- Política tenant: forzar MFA para roles ADMIN/OWNER (columna `Tenants.require_mfa`).
- Endpoint regenerar recovery codes sin disable.
- Step-up integrado en operaciones críticas concretas: delete tenant, change billing plan, rotate API key — `requireMfaChallenge` ya existe, falta llamarlo en cada endpoint.
- Recovery via email magic link como fallback adicional.
