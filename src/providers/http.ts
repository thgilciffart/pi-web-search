/**
 * Minimal HTTP helper shared by all providers: global fetch, timeout, one retry
 * on transient failures, and error bodies surfaced through ProviderError.
 */

import { ProviderError } from "./types.js";

export interface HttpOptions {
	url: string;
	method?: "GET" | "POST";
	headers?: Record<string, string>;
	/** JSON body; sent as application/json. */
	body?: unknown;
	/** Request timeout in milliseconds. Default: 15s. */
	timeoutMs?: number;
	/** Caller abort signal (e.g. the tool execution signal). */
	signal?: AbortSignal;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

/** Combines a caller signal with a timeout into one abort signal, plus a cleanup function. */
function composeSignal(
	signal: AbortSignal | undefined,
	timeoutMs: number,
): { signal: AbortSignal; cleanup: () => void } {
	const controller = new AbortController();
	const onAbort = () => controller.abort();
	if (signal) {
		if (signal.aborted) controller.abort();
		else signal.addEventListener("abort", onAbort, { once: true });
	}
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	const cleanup = () => {
		clearTimeout(timer);
		signal?.removeEventListener("abort", onAbort);
	};
	if (signal) signal.addEventListener("abort", cleanup, { once: true });
	return { signal: controller.signal, cleanup };
}

async function readErrorBody(response: Response): Promise<string> {
	try {
		const text = await response.text();
		return text.slice(0, 500).replace(/\s+/g, " ").trim();
	} catch {
		return "";
	}
}

async function extractMessage(response: Response): Promise<string> {
	const body = await readErrorBody(response);
	if (!body) return response.statusText || `HTTP ${response.status}`;
	try {
		const parsed = JSON.parse(body) as Record<string, unknown>;
		for (const key of ["detail", "message", "error", "error_message"]) {
			const value = parsed[key];
			if (typeof value === "string" && value) return value;
			if (value && typeof value === "object") {
				const nested = value as Record<string, unknown>;
				if (typeof nested.error === "string" && nested.error) return nested.error;
				if (typeof nested.message === "string" && nested.message) return nested.message;
			}
		}
	} catch {
		// Not JSON; return raw body.
	}
	return body;
}

/**
 * Performs an HTTP request and parses the JSON response.
 * Retries once on 429/5xx after a short delay. Throws ProviderError on failure.
 */
export async function fetchJson<T>(provider: string, options: HttpOptions): Promise<T> {
	const { url, method = "GET", headers = {}, body, timeoutMs = DEFAULT_TIMEOUT_MS, signal } = options;

	const headersWithAccept = {
		Accept: "application/json",
		...headers,
		...(body !== undefined ? { "Content-Type": "application/json" } : {}),
	};

	let lastError: ProviderError | undefined;

	for (let attempt = 0; attempt < 2; attempt++) {
		if (attempt > 0) {
			// Brief backoff before the single retry; honors the caller signal.
			await new Promise<void>((resolve, reject) => {
				const timer = setTimeout(resolve, 1_200);
				const onAbort = () => {
					clearTimeout(timer);
					reject(new ProviderError(provider, "aborted"));
				};
				if (signal?.aborted) {
					clearTimeout(timer);
					reject(new ProviderError(provider, "aborted"));
					return;
				}
				signal?.addEventListener("abort", onAbort, { once: true });
			});
		}

		const composed = composeSignal(signal, timeoutMs);
		try {
			const response = await fetch(url, {
				method,
				headers: headersWithAccept,
				body: body !== undefined ? JSON.stringify(body) : undefined,
				signal: composed.signal,
			});

			if (RETRYABLE_STATUS.has(response.status) && attempt === 0) {
				lastError = new ProviderError(provider, `HTTP ${response.status}`, response.status);
				continue;
			}

			if (!response.ok) {
				const message = await extractMessage(response);
				throw new ProviderError(provider, `HTTP ${response.status}: ${message}`, response.status);
			}

			return (await response.json()) as T;
		} catch (error) {
			if (error instanceof ProviderError) {
				if (error.message === "aborted") throw error;
				lastError = error;
				if (error.status && !RETRYABLE_STATUS.has(error.status)) throw error;
				continue;
			}
			if (error instanceof Error && error.name === "AbortError") {
				throw new ProviderError(provider, signal?.aborted ? "aborted" : `timed out after ${timeoutMs}ms`);
			}
			lastError = new ProviderError(provider, error instanceof Error ? error.message : String(error));
			continue;
		} finally {
			composed.cleanup();
		}
	}

	throw lastError ?? new ProviderError(provider, "request failed");
}

/**
 * Performs an HTTP request expecting HTML/text back (used by DuckDuckGo).
 * Same retry semantics as fetchJson.
 */
export async function fetchText(provider: string, options: HttpOptions): Promise<string> {
	const { url, method = "GET", headers = {}, body, timeoutMs = DEFAULT_TIMEOUT_MS, signal } = options;

	const initBody = body !== undefined && method === "POST" ? (body as string) : undefined;

	for (let attempt = 0; attempt < 2; attempt++) {
		if (attempt > 0) {
			await new Promise((resolve) => setTimeout(resolve, 1_200));
		}
		const composed = composeSignal(signal, timeoutMs);
		try {
			const response = await fetch(url, {
				method,
				headers: { ...headers, ...(initBody !== undefined ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
				body: initBody,
				signal: composed.signal,
			});
			if (RETRYABLE_STATUS.has(response.status) && attempt === 0) continue;
			if (!response.ok) {
				const message = (await readErrorBody(response)) || response.statusText;
				throw new ProviderError(provider, `HTTP ${response.status}: ${message}`, response.status);
			}
			return await response.text();
		} catch (error) {
			if (error instanceof ProviderError) {
				if (!error.status || !RETRYABLE_STATUS.has(error.status)) throw error;
				continue;
			}
			if (error instanceof Error && error.name === "AbortError") {
				throw new ProviderError(provider, signal?.aborted ? "aborted" : `timed out after ${timeoutMs}ms`);
			}
			if (attempt > 0) {
				throw new ProviderError(provider, error instanceof Error ? error.message : String(error));
			}
		} finally {
			composed.cleanup();
		}
	}
	throw new ProviderError(provider, "request failed");
}
