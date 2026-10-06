import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { effectiveFallbackOrder, pickDefaultProvider, resolveSettings } from "../src/config.js";
import { buildProviders, PROVIDER_ORDER } from "../src/providers/index.js";
import { parseDuckDuckGoHtml, unwrapDuckUrl } from "../src/providers/duckduckgo.js";
import { truncate, decodeHtmlEntities } from "../src/providers/types.js";

const tempDirs: string[] = [];
afterAll(() => {
	for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

function makeProjectDir(config?: Record<string, unknown>): string {
	const dir = mkdtempSync(join(tmpdir(), "pi-web-search-test-"));
	tempDirs.push(dir);
	if (config) {
		mkdirSync(join(dir, ".pi"), { recursive: true });
		writeFileSync(join(dir, ".pi", "web-search.json"), JSON.stringify(config));
	}
	return dir;
}

const SAVED_ENV: Record<string, string | undefined> = {};
const ENV_KEYS = ["TAVILY_API_KEY", "BRAVE_SEARCH_API_KEY", "SERPER_API_KEY", "SEARXNG_URL", "PARALLEL_API_KEY"];

function withEnv(overrides: Record<string, string | undefined>): void {
	for (const key of ENV_KEYS) {
		SAVED_ENV[key] ??= process.env[key];
		if (key in overrides) {
			if (overrides[key] === undefined) delete process.env[key];
			else process.env[key] = overrides[key];
		}
	}
}

function restoreEnv(): void {
	for (const key of ENV_KEYS) {
		if (SAVED_ENV[key] === undefined) delete process.env[key];
		else process.env[key] = SAVED_ENV[key];
	}
}

describe("duckduckgo html parsing", () => {
	test("extracts titles, urls, and snippets from result markup", () => {
		const html = `
		<table>
		<tr><a rel="nofollow" class="result__a" href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fpage&amp;rut=abc">Example &amp; Page</a></tr>
		<tr><a class="result__snippet" href="#">First &lt;snippet&gt; text</a></tr>
		<tr><a rel="nofollow" class="result__a" href="https://other.org/doc">Other doc</a></tr>
		<tr><a class="result__snippet" href="#">Second snippet</a></tr>
		<tr><a rel="nofollow" class="result__a" href="https://duckduckgo.com/y.js?ad_provider=foo">Ad slot</a></tr>
		</table>`;
		const results = parseDuckDuckGoHtml(html);
		expect(results).toHaveLength(2);
		expect(results[0].url).toBe("https://example.com/page");
		expect(results[0].title).toBe("Example & Page");
		expect(results[0].snippet).toBe("First <snippet> text");
		expect(results[1].url).toBe("https://other.org/doc");
		expect(results[1].snippet).toBe("Second snippet");
	});

	test("unwraps redirect links", () => {
		expect(unwrapDuckUrl("//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa")).toBe(
			"https://example.com/a",
		);
		expect(unwrapDuckUrl("https://plain.example.com/x")).toBe("https://plain.example.com/x");
	});
});

describe("text helpers", () => {
	test("truncate keeps short strings and cuts long ones", () => {
		expect(truncate("short", 10)).toBe("short");
		expect(truncate("a".repeat(100), 10)).toHaveLength(10);
		expect(truncate("a".repeat(100), 10).endsWith("…")).toBe(true);
	});

	test("decodeHtmlEntities handles common entities", () => {
		expect(decodeHtmlEntities("&amp;lt; &#x27;quotes&#39; &quot;d&quot;")).toBe("< 'quotes' \"d\"");
	});
});

describe("config resolution", () => {
	test("env vars activate providers", () => {
		withEnv({ TAVILY_API_KEY: "tvly-test", SEARXNG_URL: "http://localhost:8888" });
		const settings = resolveSettings(makeProjectDir());
		expect(settings.providers.tavily?.apiKey).toBe("tvly-test");
		expect(settings.providers.searxng?.baseUrl).toBe("http://localhost:8888");
		restoreEnv();
	});

	test("project config file provides keys and defaults", () => {
		withEnv({ TAVILY_API_KEY: undefined, SEARXNG_URL: undefined });
		const dir = makeProjectDir({
			defaultProvider: "brave",
			maxResults: 8,
			providers: { brave: { apiKey: "brave-key" }, searxng: { baseUrl: "http://searx:8080" } },
		});
		const settings = resolveSettings(dir);
		expect(settings.defaultProvider).toBe("brave");
		expect(settings.maxResults).toBe(8);
		expect(settings.providers.brave?.apiKey).toBe("brave-key");
		expect(settings.providers.searxng?.baseUrl).toBe("http://searx:8080");
		expect(settings.configFiles).toHaveLength(1);
		restoreEnv();
	});

	test("invalid config entries are ignored gracefully", () => {
		const dir = makeProjectDir({
			defaultProvider: 42,
			maxResults: -3,
			providers: { notaprovider: { apiKey: "x" }, tavily: "bad-value" },
		});
		const settings = resolveSettings(dir);
		expect(settings.defaultProvider).toBeUndefined();
		expect(settings.maxResults).toBeUndefined();
		expect(settings.providers.tavily).toBeUndefined();
		expect(settings.providers.notaprovider).toBeUndefined();
	});

	test("fallback order and default provider selection", () => {
		withEnv({ TAVILY_API_KEY: undefined, BRAVE_SEARCH_API_KEY: "brave-key" });
		const settings = resolveSettings(makeProjectDir());
		const order = effectiveFallbackOrder(settings);
		expect(order[0]).toBe("tavily");
		expect(order).toContain("duckduckgo");
		// Only brave is configured, so it becomes the default.
		expect(pickDefaultProvider(settings, ["brave", "duckduckgo"])).toBe("brave");
		restoreEnv();
	});
});

describe("provider registry", () => {
	test("builds only providers with credentials; duckduckgo always present", () => {
		const providers = buildProviders({
			tavily: { apiKey: "tvly-x" },
			brave: {}, // no key
		});
		const names = providers.map((p) => p.name);
		expect(names).toContain("tavily");
		expect(names).not.toContain("brave");
		expect(names).toContain("duckduckgo");
		expect(names).toHaveLength(2);
	});

	test("registry covers every provider in PROVIDER_ORDER", () => {
		const all = buildProviders(
			Object.fromEntries(
				PROVIDER_ORDER.map((name) => [
					name,
					name === "searxng" ? { baseUrl: "http://localhost:8080" } : { apiKey: "test" },
				]),
			),
		);
		expect(all.map((p) => p.name)).toEqual([...PROVIDER_ORDER]);
	});
});
