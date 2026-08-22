import { describe, it, expect } from "vitest";
import {
    clientIpFromHeaders,
    countRemainingRecoveryCodes,
    derivePrimaryMethod,
    deviceLabelFromUserAgent,
    buildTwoFactorStatus,
    isFailureEvent,
    mapAuditEvent,
    mapSecurityKey,
    needsRecoveryCodesRefresh,
    toMethod,
    userAgentFromHeaders,
} from "@/services/user2fa.service";

describe("2FA — método primario", () => {
    it("una llave física gana sobre TOTP: es el factor que resiste phishing", () => {
        expect(derivePrimaryMethod(true, 1)).toBe("FIDO2_WEBAUTHN");
        expect(derivePrimaryMethod(false, 2)).toBe("FIDO2_WEBAUTHN");
    });

    it("sin llaves, TOTP", () => {
        expect(derivePrimaryMethod(true, 0)).toBe("TOTP");
    });

    it("sin TOTP ni llaves sólo quedan los códigos de recuperación", () => {
        expect(derivePrimaryMethod(false, 0)).toBe("RECOVERY_CODE");
    });
});

describe("2FA — estado", () => {
    it("arma el estado completo y no deja contadores negativos", () => {
        const s = buildTwoFactorStatus({
            isEnabled: true,
            hasTotpSecret: true,
            lastUsedAt: "2026-08-22T10:00:00.000Z",
            remainingRecoveryCodesCount: -3,
            securityKeys: [],
        });
        expect(s.isEnabled).toBe(true);
        expect(s.primaryMethod).toBe("TOTP");
        expect(s.remainingRecoveryCodesCount).toBe(0);
        expect(s.registeredSecurityKeysCount).toBe(0);
        expect(s.lastUsedAt).toBe("2026-08-22T10:00:00.000Z");
    });

    it("cuenta los códigos desde el JSON de hashes, en array o en string", () => {
        expect(countRemainingRecoveryCodes(["a", "b", "c"])).toBe(3);
        expect(countRemainingRecoveryCodes('["a","b"]')).toBe(2);
        expect(countRemainingRecoveryCodes(null)).toBe(0);
        expect(countRemainingRecoveryCodes("{roto")).toBe(0);
    });

    it("avisa cuando quedan pocos códigos, incluido el cero", () => {
        expect(needsRecoveryCodesRefresh(0)).toBe(true);
        expect(needsRecoveryCodesRefresh(3)).toBe(true);
        expect(needsRecoveryCodesRefresh(4)).toBe(false);
        expect(needsRecoveryCodesRefresh(10)).toBe(false);
    });
});

describe("2FA — user agent", () => {
    it("detecta Edge antes que Chrome, que también dice Chrome", () => {
        expect(deviceLabelFromUserAgent("Mozilla/5.0 (Windows NT 10.0) Chrome/140 Safari/537 Edg/140")).toBe("Edge · Windows");
    });

    it("detecta Safari sólo cuando no hay Chrome ni Edge en la cadena", () => {
        expect(deviceLabelFromUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X) Safari/605.1")).toBe("Safari · macOS");
        expect(deviceLabelFromUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X) Chrome/140 Safari/537")).toBe("Chrome · macOS");
    });

    it("iOS gana sobre macOS: el UA del iPhone también dice Mac OS X", () => {
        expect(deviceLabelFromUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/605")).toBe("Safari · iOS");
    });

    it("un UA vacío o desconocido no rompe la fila", () => {
        expect(deviceLabelFromUserAgent("")).toBe("Desconocido");
        expect(deviceLabelFromUserAgent(null)).toBe("Desconocido");
        expect(deviceLabelFromUserAgent("curl/8.0")).toBe("Navegador");
    });
});

describe("2FA — normalización de la bitácora", () => {
    it("mapea la fila y deriva la etiqueta de dispositivo", () => {
        const e = mapAuditEvent({
            id: 5,
            event_type: "LOGIN_2FA_SUCCESS",
            method_used: "TOTP",
            is_success: 1,
            ip_address: "190.55.12.4",
            user_agent: "Mozilla/5.0 (Windows NT 10.0) Firefox/130",
            created_at: "2026-08-22T10:00:00.000Z",
        });
        expect(e.methodUsed).toBe("TOTP");
        expect(e.deviceLabel).toBe("Firefox · Windows");
        expect(e.isSuccess).toBe(true);
        expect(e.ipAddress).toBe("190.55.12.4");
    });

    it("un método desconocido queda undefined en vez de inventarse uno", () => {
        expect(mapAuditEvent({ id: 1, method_used: "SMS" }).methodUsed).toBeUndefined();
        expect(toMethod("fido2_webauthn")).toBe("FIDO2_WEBAUTHN");
        expect(toMethod(null)).toBeUndefined();
    });

    it("sin IP registrada muestra un guion, no 'null'", () => {
        expect(mapAuditEvent({ id: 1 }).ipAddress).toBe("—");
    });

    it("LOGIN_2FA_FAILED cuenta como fallo aunque is_success venga en 1", () => {
        expect(isFailureEvent("LOGIN_2FA_FAILED", true)).toBe(true);
        expect(isFailureEvent("LOGIN_2FA_SUCCESS", false)).toBe(true);
        expect(isFailureEvent("LOGIN_2FA_SUCCESS", true)).toBe(false);
    });

    it("una llave sin nombre no queda en blanco en la lista", () => {
        expect(mapSecurityKey({ id: 3, friendly_name: "   " }).friendlyName).toBe("Llave de seguridad");
        expect(mapSecurityKey({ id: 3, friendly_name: "YubiKey 5C", is_backed_up: 1 })).toMatchObject({
            friendlyName: "YubiKey 5C",
            isBackedUp: true,
        });
    });
});

describe("2FA — IP del cliente detrás del ingress", () => {
    it("toma el primer valor de x-forwarded-for, que es el cliente real", () => {
        const h = new Headers({ "x-forwarded-for": "190.55.12.4, 10.0.0.1, 10.0.0.2" });
        expect(clientIpFromHeaders(h)).toBe("190.55.12.4");
    });

    it("cae a x-real-ip y después a cf-connecting-ip", () => {
        expect(clientIpFromHeaders(new Headers({ "x-real-ip": "8.8.8.8" }))).toBe("8.8.8.8");
        expect(clientIpFromHeaders(new Headers({ "cf-connecting-ip": "1.1.1.1" }))).toBe("1.1.1.1");
        expect(clientIpFromHeaders(new Headers())).toBe("");
    });

    it("acota headers arbitrariamente largos al ancho de la columna", () => {
        const long = "a".repeat(500);
        expect(clientIpFromHeaders(new Headers({ "x-forwarded-for": long }))).toHaveLength(64);
        expect(userAgentFromHeaders(new Headers({ "user-agent": long }))).toHaveLength(400);
    });
});
