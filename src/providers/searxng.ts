/**
 * SearXNG — https://docs.searxng.org
 * GET {baseUrl}/search?q=…&format=json
 * Self-hosted metasearch aggregator. The instance must allow JSON output.
 */

import { fetchJson } from "./http.js";
import { ProviderError, type ProviderConfig, type SearchProvider, type SearchQuery, type WebResult } from "./types.js";

interface SearxngResult {
	title?: string;
	url?: string;
	content?: string;
	publishedDate?: number | string | null;
}

interface SearxngResponse {
	results?: SearxngResult[];
	unresponsive_engines?: unknown[];
}

const TIME_RANGE: Record<string, string> = {
	day: "day",
	week: "week",
	month: "month",
	year: "year",
};

export function createSearxngProvider(config: ProviderConfig): SearchProvider {
	const baseUrl = (config.baseUrl ?? "").replace(/\/+$/, "");
	if (!baseUrl) {
		throw new ProviderError("searxng", "missing base URL");
	}

	return {
		name: "searxng",
		label: "SearXNG",
		envVars: ["SEARXNG_URL"],

		isConfigured() {
			return Boolean(baseUrl);
		},

		async search(query: SearchQuery, signal?: AbortSignal): Promise<WebResult[]> {
			let q = query.query;
			for (const domain of query.includeDomains ?? []) {
				q = `site:${domain} ${q}`;
			}
			for (const domain of query.excludeDomains ?? []) {
				q = `${q} -site:${domain}`;
			}

			const url = new URL(`${baseUrl}/search`);
			url.searchParams.set("q", q);
			url.searchParams.set("format", "json");
			url.searchParams.set("language", typeof config.language === "string" ? config.language : "auto");
			if (query.timeRange) url.searchParams.set("time_range", TIME_RANGE[query.timeRange]);

			const headers: Record<string, string> = {};
			if (config.apiKey) {
				// Some hardened instances use X-API-Key or Bearer auth.
				headers["X-API-Key"] = String(config.apiKey);
			}

			let response: SearxngResponse;
			try {
				response = await fetchJson<SearxngResponse>("searxng", {
					url: url.toString(),
					headers,
					signal,
				});
			} catch (error) {
				if (error instanceof ProviderError && error.status === 403) {
					throw new ProviderError(
						"searxng",
						`instance at ${baseUrl} refused JSON output (403); enable the "json" format on the instance or pick one that allows it`,
						403,
					);
				}
				throw error;
			}

			return (response.results ?? [])
				.filter((result) => Boolean(result.url))
				.slice(0, query.maxResults)
				.map((result) => ({
					title: result.title ?? "",
					url: result.url ?? "",
					snippet: result.content ?? "",
					published:
						typeof result.publishedDate === "number"
							? new Date(result.publishedDate * 1000).toISOString().split("T")[0]
							: (result.publishedDate ?? undefined),
				}));
		},
	};
}
