import { afterEach, describe, expect, test } from "bun:test";
import { getEventListeners } from "node:events";
import { fetchJson, fetchText } from "../src/providers/http.js";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

for (const [name, request, successBody, expected] of [
	["JSON", fetchJson, '{"ok":true}', { ok: true }],
	["text", fetchText, "success", "success"],
] as const) {
	describe(`${name} HTTP requests`, () => {
		test("does not fetch when the caller has already aborted", async () => {
			let calls = 0;
			globalThis.fetch = (async () => { calls++; return new Response(successBody); }) as typeof fetch;
			const controller = new AbortController();
			controller.abort();
			await expect(request("test", { url: "https://example.test", signal: controller.signal })).rejects.toThrow("request aborted");
			expect(calls).toBe(0);
		});

		test("surfaces non-retryable errors without another request", async () => {
			let calls = 0;
			globalThis.fetch = (async () => {
				calls++;
				return new Response('{"message":"invalid key"}', { status: 401 });
			}) as typeof fetch;
			await expect(request("test", { url: "https://example.test" })).rejects.toMatchObject({
				provider: "test", status: 401, message: expect.stringContaining("invalid key"),
			});
			expect(calls).toBe(1);
		});

		test("releases the failed response before retrying and cleans up listeners", async () => {
			let calls = 0;
			let cancelled = false;
			const controller = new AbortController();
			globalThis.fetch = (async () => {
				if (++calls === 1) return new Response(new ReadableStream({
					cancel() { cancelled = true; },
				}), { status: 503 });
				expect(cancelled).toBe(true);
				return new Response(successBody);
			}) as typeof fetch;
			expect(await request("test", { url: "https://example.test", signal: controller.signal })).toEqual(expected);
			expect(calls).toBe(2);
			expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
		});

		test("preserves the final HTTP status and error after retries fail", async () => {
			let calls = 0;
			globalThis.fetch = (async () => {
				calls++;
				return new Response("upstream unavailable", { status: 503 });
			}) as typeof fetch;
			await expect(request("test", { url: "https://example.test" })).rejects.toMatchObject({
				status: 503, message: expect.stringContaining("upstream unavailable"),
			});
			expect(calls).toBe(2);
		});

		test("aborts promptly during retry backoff without sending another request", async () => {
			let calls = 0;
			const controller = new AbortController();
			globalThis.fetch = (async () => {
				calls++;
				return new Response("retry", { status: 429 });
			}) as typeof fetch;
			const pending = request("test", { url: "https://example.test", signal: controller.signal });
			const timer = setTimeout(() => controller.abort(), 20);
			try {
				await expect(pending).rejects.toThrow("request aborted");
				expect(calls).toBe(1);
				expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
			} finally {
				clearTimeout(timer);
			}
		}, 700);

		test("recognizes timeout cancellation even when fetch throws a different error type", async () => {
			let calls = 0;
			globalThis.fetch = ((_url, init) => {
				calls++;
				return new Promise((_resolve, reject) => {
					init!.signal!.addEventListener("abort", () => reject(new TypeError("fetch cancelled")), { once: true });
				});
			}) as typeof fetch;
			await expect(request("test", { url: "https://example.test", timeoutMs: 10 })).rejects.toThrow("request timed out after 10 ms");
			expect(calls).toBe(1);
		});
	});
}
