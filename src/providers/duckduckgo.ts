/**
 * DuckDuckGo — https://duckduckgo.com
 * POST https://html.duckduckgo.com/html/ (no API key)
 *
 * Unofficial endpoint with no guaranteed contract: keep queries infrequent,
 * expect occasional blocks, and treat failures as "provider unavailable".
 */

import { fetchText } from "./http.js";
import {
	ProviderError,
	decodeHtmlEntities,
	type ProviderConfig,
	type SearchProvider,
	type SearchQuery,
	type WebResult,
} from "./types.js";

const USER_AGENT =
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const DF_PARAM: Record<string, string> = {
	day: "d",
	week: "w",
	month: "m",
	year: "y",
};

/** Extracts the real destination URL from DuckDuckGo redirect links. */
export function unwrapDuckUrl(href: string): string {
	try {
		const absolute = href.startsWith("http") ? href : `https:${href}`;
		const url = new URL(absolute);
		const target = url.searchParams.get("uddg");
		if (target) return target;
		return absolute;
	} catch {
		return href;
	}
}

function stripTags(html: string): string {
	return decodeHtmlEntities(html.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
}

/** Parses the html.duckduckgo.com results table into title/snippet pairs. */
export function parseDuckDuckGoHtml(html: string): WebResult[] {
	const results: WebResult[] = [];

	// Results are <a rel="nofollow" class="result__a" href="...">Title</a>
	// followed by a snippet block <a class="result__snippet" ...>…</a>.
	const linkPattern = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
	const snippetPattern = /<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/g;

	const links: Array<{ url: string; title: string }> = [];
	let match: RegExpExecArray | null;
	while ((match = linkPattern.exec(html)) !== null) {
		links.push({ url: unwrapDuckUrl(decodeHtmlEntities(match[1])), title: stripTags(match[2]) });
	}

	const snippets: string[] = [];
	while ((match = snippetPattern.exec(html)) !== null) {
		snippets.push(stripTags(match[1]));
	}

	for (let i = 0; i < links.length; i++) {
		const { url, title } = links[i];
		if (!url || url.includes("duckduckgo.com/y.js")) continue; // skip ad slots
		results.push({
			title: title || url,
			url,
			snippet: snippets[i] ?? "",
		});
	}

	return results;
}

export function createDuckDuckGoProvider(_config: ProviderConfig): SearchProvider {
	// Politeness throttle: DuckDuckGo rate-limits aggressive clients hard.
	let lastRequestAt = 0;
	const MIN_INTERVAL_MS = 1_200;

	return {
		name: "duckduckgo",
		label: "DuckDuckGo",
		envVars: [],

		isConfigured() {
			return true; // No key required; works (best-effort) from most networks.
		},

		async search(query: SearchQuery, signal?: AbortSignal): Promise<WebResult[]> {
			const wait = lastRequestAt + MIN_INTERVAL_MS - Date.now();
			if (wait > 0) {
				await new Promise((resolve) => setTimeout(resolve, wait));
			}
			lastRequestAt = Date.now();

			let q = query.query;
			if (query.includeDomains?.length) {
				q = `(${query.includeDomains.map((d) => `site:${d}`).join(" OR ")}) ${q}`;
			}
			for (const domain of query.excludeDomains ?? []) {
				q = `${q} -site:${domain}`;
			}

			const form = new URLSearchParams({ q, kl: "wt-wt" });
			if (query.timeRange && DF_PARAM[query.timeRange]) form.set("df", DF_PARAM[query.timeRange]);

			const html = await fetchText("duckduckgo", {
				url: "https://html.duckduckgo.com/html/",
				method: "POST",
				headers: {
					"User-Agent": USER_AGENT,
					Accept: "text/html",
				},
				body: form.toString(),
				timeoutMs: 20_000,
				signal,
			});

			if (html.includes("anomaly") || html.includes("challenge")) {
				throw new ProviderError(
					"duckduckgo",
					"DuckDuckGo returned a bot challenge for this network. Try a different provider.",
				);
			}

			const results = parseDuckDuckGoHtml(html);
			if (results.length === 0 && !/<form[^>]*action="[^"]*"/.test(html)) {
				throw new ProviderError(
					"duckduckgo",
					"DuckDuckGo returned a response the parser does not recognize. The page format may have changed.",
				);
			}
			return results.slice(0, query.maxResults);
		},
	};
}
