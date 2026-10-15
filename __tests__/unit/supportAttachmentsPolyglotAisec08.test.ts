// @vitest-environment node
import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import sharp from "sharp";
import { NextRequest } from "next/server";

const { accessMock, roleMock, rateMock, queryMock, saveMock, deleteMock, AuthError } = vi.hoisted(() => {
    class AuthError extends Error {
        status: number;
        constructor(message: string, status = 401) { super(message); this.status = status; }
    }
    return {
        accessMock: vi.fn(), roleMock: vi.fn(), rateMock: vi.fn(), queryMock: vi.fn(),
        saveMock: vi.fn(), deleteMock: vi.fn(), AuthError,
    };
});
vi.mock("@/lib/requestAuth", () => ({ requireTenantAccess: accessMock, hasSystemRole: roleMock, AuthError }));
vi.mock("@/lib/rateLimiter", () => ({ default: { checkByKeyDistributed: rateMock } }));
vi.mock("@/modules/storage/db", () => ({ default: { query: queryMock } }));
vi.mock("@/lib/supportAttachments", async (orig) => ({
    ...(await orig<typeof import("@/lib/supportAttachments")>()),
    saveAttachment: saveMock,
    deleteAttachmentFile: deleteMock,
}));

import { POST } from "@/app/api/support/tickets/[id]/attachments/route";
import { validateAttachment, reencodeImage, SUPPORT_ATTACHMENT_MAX_BYTES } from "@/lib/supportAttachments";

const PNG = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 1, 2, 3, 4,
    0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0xff, 0xd9]);
const TAIL = Buffer.from("<html><script>alert(1)</script></html>");

describe("validateAttachment (AISEC-08)", () => {
    it("acepta PNG y JPEG bien formados", () => {
        expect(validateAttachment("a.png", PNG).ok).toBe(true);
        expect(validateAttachment("a.jpg", JPEG).ok).toBe(true);
        expect(validateAttachment("a.jpeg", JPEG).ok).toBe(true);
    });

    it("rechaza polyglots: imagen válida con datos pegados al final", () => {
        expect(validateAttachment("a.png", Buffer.concat([PNG, TAIL])).ok).toBe(false);
        expect(validateAttachment("a.jpg", Buffer.concat([JPEG, TAIL])).ok).toBe(false);
    });

    it("exige la firma PNG completa de 8 bytes, no sólo los 4 primeros", () => {
        const bad = Buffer.from(PNG);
        bad[4] = 0x00;
        expect(validateAttachment("a.png", bad).ok).toBe(false);
    });

    it("rechaza imágenes truncadas o con sólo la firma", () => {
        expect(validateAttachment("a.jpg", Buffer.from([0xff, 0xd8, 0xff, 0xd9])).ok).toBe(false);
        expect(validateAttachment("a.png", PNG.subarray(0, PNG.length - 1)).ok).toBe(false);
    });

    it("txt/json: rechaza NUL y JSON inválido", () => {
        expect(validateAttachment("a.txt", Buffer.from("hola\u0000mundo")).ok).toBe(false);
        expect(validateAttachment("a.json", Buffer.from("{no json")).ok).toBe(false);
        expect(validateAttachment("a.json", Buffer.from('\uFEFF{"ok":true}')).ok).toBe(true);
        expect(validateAttachment("a.txt", Buffer.from("texto ñ")).ok).toBe(true);
    });
});

// Imágenes reales (decodificables por sharp) con metadatos que la re-codificación debe quitar.
let REAL_PNG: Buffer;
let REAL_JPEG: Buffer;
const SECRET = "SECRETO-EXIF-AISEC08";
beforeAll(async () => {
    const base = sharp({ create: { width: 4, height: 2, channels: 3, background: { r: 200, g: 10, b: 10 } } });
    REAL_PNG = await base.clone().png().withMetadata({ exif: { IFD0: { ImageDescription: SECRET } } }).toBuffer();
    REAL_JPEG = await base.clone().jpeg().withMetadata({ orientation: 6, exif: { IFD0: { ImageDescription: SECRET } } }).toBuffer();
});

describe("reencodeImage (AISEC-08, defensa adicional)", () => {
    it("re-codifica PNG y JPEG quitando EXIF y metadatos", async () => {
        expect(REAL_PNG.includes(SECRET)).toBe(true);
        expect(REAL_JPEG.includes(SECRET)).toBe(true);
        for (const [ext, img] of [["png", REAL_PNG], ["jpg", REAL_JPEG]] as const) {
            const r = await reencodeImage(ext, img);
            expect(r.ok, ext).toBe(true);
            expect(r.bytes!.includes(SECRET), ext).toBe(false);
            const meta = await sharp(r.bytes!).metadata();
            expect(meta.exif, ext).toBeUndefined();
            expect(meta.format, ext).toBe(ext === "png" ? "png" : "jpeg");
            expect(validateAttachment(`a.${ext}`, r.bytes!).ok, ext).toBe(true);
        }
    });

    it("aplica la orientación EXIF antes de descartarla", async () => {
        const r = await reencodeImage("jpg", REAL_JPEG);
        const meta = await sharp(r.bytes!).metadata();
        expect([meta.width, meta.height]).toEqual([2, 4]);
        expect(meta.orientation).toBeUndefined();
    });

    it("rechaza imágenes que pasan las firmas pero no se pueden decodificar", async () => {
        expect(validateAttachment("a.png", PNG).ok).toBe(true);
        expect((await reencodeImage("png", PNG)).ok).toBe(false);
        expect((await reencodeImage("jpg", JPEG)).ok).toBe(false);
    });

    it("rechaza bombas de descompresión (demasiados píxeles)", async () => {
        const bomb = await sharp({ create: { width: 10000, height: 5000, channels: 3, background: "#000" } }).png().toBuffer();
        expect(bomb.length).toBeLessThan(SUPPORT_ATTACHMENT_MAX_BYTES);
        expect((await reencodeImage("png", bomb)).ok).toBe(false);
    });

    it("txt/json pasan sin tocar", async () => {
        const txt = Buffer.from("hola");
        expect((await reencodeImage("txt", txt)).bytes).toBe(txt);
    });
});

function form(file: { name: string; bytes: Buffer }, extra: Record<string, string> = {}): FormData {
    const fd = new FormData();
    fd.set("tenantId", "t1");
    for (const [k, v] of Object.entries(extra)) fd.set(k, v);
    fd.set("file", new File([new Uint8Array(file.bytes)], file.name));
    return fd;
}

const upload = (fd: FormData) => new NextRequest("http://localhost/api/support/tickets/7/attachments", { method: "POST", body: fd });
const params = { params: Promise.resolve({ id: "7" }) };

type Message = { id: number; ticket_id: number; is_internal_note: number };
let messages: Message[];
let insertFails: boolean;

beforeEach(() => {
    accessMock.mockReset().mockResolvedValue({ email: "ana@x.com", isCorporateDomain: false });
    roleMock.mockReset().mockResolvedValue(false);
    rateMock.mockReset().mockResolvedValue({ allowed: true });
    saveMock.mockReset().mockResolvedValue("prefix/123e4567-e89b-12d3-a456-426614174000.png");
    deleteMock.mockReset().mockResolvedValue(undefined);
    messages = [
        { id: 11, ticket_id: 7, is_internal_note: 0 },
        { id: 12, ticket_id: 7, is_internal_note: 1 },
        { id: 99, ticket_id: 8, is_internal_note: 0 },
    ];
    insertFails = false;
    queryMock.mockReset().mockImplementation(async (sql: string, args: unknown[]) => {
        if (sql.includes("FROM SupportTickets")) return [[{ id: 7, status: "open" }]];
        if (sql.includes("COUNT(*)")) return [[{ c: 0 }]];
        if (sql.includes("FROM SupportTicketMessages")) {
            return [messages.filter((m) => m.id === args[0] && m.ticket_id === args[1])];
        }
        if (sql.includes("INSERT INTO SupportTicketAttachments")) {
            if (insertFails) throw new Error("db down");
            return [{ insertId: 5 }];
        }
        return [[]];
    });
});

const insertArgs = () => queryMock.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO SupportTicketAttachments"))?.[1];

describe("POST /api/support/tickets/[id]/attachments (AISEC-08)", () => {
    it("acepta una imagen limpia y la asocia al mensaje del propio ticket", async () => {
        const res = await POST(upload(form({ name: "a.png", bytes: REAL_PNG }, { messageId: "11" })), params);
        expect(res.status).toBe(201);
        expect(insertArgs()?.[1]).toBe(11);
    });

    it("PNG con datos extra al final → 415 y no se guarda", async () => {
        const res = await POST(upload(form({ name: "a.png", bytes: Buffer.concat([REAL_PNG, TAIL]) })), params);
        expect(res.status).toBe(415);
        expect(saveMock).not.toHaveBeenCalled();
    });

    it("messageId de otro ticket → 400 y no se guarda", async () => {
        const res = await POST(upload(form({ name: "a.png", bytes: REAL_PNG }, { messageId: "99" })), params);
        expect(res.status).toBe(400);
        expect(saveMock).not.toHaveBeenCalled();
    });

    it("messageId inexistente o malformado → 400", async () => {
        for (const messageId of ["12345", "abc", "-1", "1.5", "1e3"]) {
            const res = await POST(upload(form({ name: "a.png", bytes: REAL_PNG }, { messageId })), params);
            expect(res.status, messageId).toBe(400);
        }
        expect(saveMock).not.toHaveBeenCalled();
    });

    it("un usuario no puede colgar adjuntos de una nota interna; soporte sí", async () => {
        let res = await POST(upload(form({ name: "a.png", bytes: REAL_PNG }, { messageId: "12" })), params);
        expect(res.status).toBe(400);

        accessMock.mockResolvedValue({ email: "soporte@corp.com", isCorporateDomain: true });
        roleMock.mockResolvedValue(true);
        res = await POST(upload(form({ name: "a.png", bytes: REAL_PNG }, { messageId: "12" })), params);
        expect(res.status).toBe(201);
    });

    it("se guarda la imagen re-codificada, no los bytes subidos", async () => {
        const res = await POST(upload(form({ name: "a.jpg", bytes: REAL_JPEG })), params);
        expect(res.status).toBe(201);
        const saved: Buffer = saveMock.mock.calls[0][1];
        expect(saved.equals(REAL_JPEG)).toBe(false);
        expect(saved.includes(SECRET)).toBe(false);
        expect(insertArgs()?.[8]).toBe(saved.length);
    });

    it("imagen con firmas válidas pero indecodificable → 415", async () => {
        const res = await POST(upload(form({ name: "a.png", bytes: PNG })), params);
        expect(res.status).toBe(415);
        expect(saveMock).not.toHaveBeenCalled();
    });

    it("sin messageId el adjunto queda a nivel ticket", async () => {
        const res = await POST(upload(form({ name: "a.png", bytes: REAL_PNG })), params);
        expect(res.status).toBe(201);
        expect(insertArgs()?.[1]).toBeNull();
    });

    it("si el INSERT falla se borra el blob recién subido", async () => {
        insertFails = true;
        const res = await POST(upload(form({ name: "a.png", bytes: REAL_PNG })), params);
        expect(res.status).toBe(500);
        expect(deleteMock).toHaveBeenCalledWith("t1", "prefix/123e4567-e89b-12d3-a456-426614174000.png");
    });

    it("Content-Length declarado > 5 MB → 413 sin leer el body ni autenticar", async () => {
        const req = new NextRequest("http://localhost/api/support/tickets/7/attachments", {
            method: "POST",
            headers: { "content-type": "multipart/form-data; boundary=x", "content-length": String(SUPPORT_ATTACHMENT_MAX_BYTES * 2) },
            body: "x",
        });
        const res = await POST(req, params);
        expect(res.status).toBe(413);
        expect(accessMock).not.toHaveBeenCalled();
    });

    it("body sin Content-Length que supera el tope se corta mientras llega", async () => {
        const chunk = new Uint8Array(1024 * 1024);
        let pulled = 0;
        const stream = new ReadableStream<Uint8Array>({
            pull(controller) {
                pulled++;
                if (pulled > 50) controller.close();
                else controller.enqueue(chunk);
            },
        });
        const req = new NextRequest("http://localhost/api/support/tickets/7/attachments", {
            method: "POST",
            headers: { "content-type": "multipart/form-data; boundary=x" },
            body: stream,
            duplex: "half",
        } as RequestInit & { duplex: "half" });
        const res = await POST(req, params);
        expect(res.status).toBe(413);
        expect(pulled).toBeLessThanOrEqual(8);
        expect(accessMock).not.toHaveBeenCalled();
    });

    it("multipart corrupto → 400", async () => {
        const req = new NextRequest("http://localhost/api/support/tickets/7/attachments", {
            method: "POST",
            headers: { "content-type": "multipart/form-data; boundary=x" },
            body: "basura",
        });
        expect((await POST(req, params)).status).toBe(400);
    });
});
