import { Agent, fetch as undiciFetch } from "undici";
import { resolvePublicHttpsTarget } from "@/lib/webhookSecurity";

const MAX_RESPONSE_BYTES = 1024 * 1024;
const TIMEOUT_MS = 15_000;
type OutboundRequestInit = Pick<RequestInit, "method" | "headers" | "signal" | "redirect"> & { body?: string };

/**
 * Resolves once, pins the socket lookup and preserves the URL's hostname for
 * Host/SNI/certificate validation. Each call owns and closes its dispatcher.
 */
export async function safeExternalFetch(
  rawUrl: string,
  init: OutboundRequestInit = {},
  policy: "public" | "webhook" = "public",
): Promise<Response> {
  const signal = init.signal
    ? AbortSignal.any([init.signal, AbortSignal.timeout(TIMEOUT_MS)])
    : AbortSignal.timeout(TIMEOUT_MS);
  signal.throwIfAborted();
  const { url, addresses } = await new Promise<Awaited<ReturnType<typeof resolvePublicHttpsTarget>>>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    resolvePublicHttpsTarget(rawUrl, policy === "webhook").then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", onAbort);
    });
  });
  signal.throwIfAborted();
  const dispatcher = new Agent({
    connect: {
      timeout: TIMEOUT_MS,
      lookup(hostname, options, callback) {
        if (hostname.toLowerCase() !== url.hostname.toLowerCase()) {
          callback(new Error("Outbound hostname changed"), "", 0);
          return;
        }
        const candidates = addresses.filter(entry => !options.family || entry.family === options.family);
        if (candidates.length === 0) {
          callback(new Error("No validated address for requested family"), "", 0);
        } else if (options.all) {
          callback(null, candidates);
        } else {
          callback(null, candidates[0].address, candidates[0].family);
        }
      },
    },
  });
  try {
    const options = {
      ...init, headers: Object.fromEntries(new Headers(init.headers)),
      signal, redirect: "error" as const, dispatcher,
    };
    const response = await undiciFetch(url, options);
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      throw new Error("Outbound redirects are not allowed");
    }
    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    if (reader) {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          length += value.byteLength;
          if (length > MAX_RESPONSE_BYTES) {
            await reader.cancel();
            throw new Error("Outbound response exceeds size limit");
          }
          chunks.push(value);
        }
      } finally {
        reader.releaseLock();
      }
    }
    return new Response(
      response.status === 204 || response.status === 205 || response.status === 304
        ? null : Buffer.concat(chunks, length),
      { status: response.status, statusText: response.statusText, headers: Object.fromEntries(response.headers) },
    );
  } finally {
    await dispatcher.destroy();
  }
}

export function safeWebhookFetch(rawUrl: string, init: OutboundRequestInit = {}): Promise<Response> {
  return safeExternalFetch(rawUrl, init, "webhook");
}
