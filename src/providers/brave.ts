/**
 * Brave Search — https://brave.com/search/api/
 * GET https://api.search.brave.com/res/v1/web/search (X-Subscription-Token)
 */

import { fetchJson } from "./http.js";
import { ProviderError, decodeHtmlEntities, type ProviderConfig, type SearchProvider, type SearchQuery, type WebResult } from "./types.js";

interface BraveResult {
	title?: string;
	url?: string;
	description?: string;
	age?: string;
	page_age?: string;
}

interface BraveResponse {
	web?: {
		results?: BraveResult[];
	};
}

const FRESHNESS: Record<string, string> = {
	day: "pd",
	week: "pw",
	month: "pm",
	year: "py",
};

export function createBraveProvider(config: ProviderConfig): SearchProvider {
	const apiKey = config.apiKey;
	if (!apiKey) {
		throw new ProviderError("brave", "missing API key");
	}

	return {
		name: "brave",
		label: "Brave Search",
		envVars: ["BRAVE_SEARCH_API_KEY", "BRAVE_API_KEY"],

		isConfigured() {
			return Boolean(apiKey);
		},

		async search(query: SearchQuery, signal?: AbortSignal): Promise<WebResult[]> {
			const url = new URL("https://api.search.brave.com/res/v1/web/search");
			// Brave has no include/exclude domain params; site: operators cover the common case.
			let q = query.query;
			if (query.includeDomains?.length) {
				q = `(${query.includeDomains.map((d) => `site:${d}`).join(" OR ")}) ${q}`;
			}
			for (const domain of query.excludeDomains ?? []) {
				q = `${q} -site:${domain}`;
			}
			url.searchParams.set("q", q);
			url.searchParams.set("count", String(Math.min(query.maxResults, 20)));
			url.searchParams.set("result_filter", "web");
			if (query.timeRange) url.searchParams.set("freshness", FRESHNESS[query.timeRange]);

			const response = await fetchJson<BraveResponse>("brave", {
				url: url.toString(),
				headers: {
					"X-Subscription-Token": apiKey,
					Accept: "application/json",
				},
				signal,
			});

			return (response.web?.results ?? []).map((result) => ({
				title: decodeHtmlEntities(result.title ?? ""),
				url: result.url ?? "",
				snippet: decodeHtmlEntities(result.description ?? ""),
				published: result.page_age ?? result.age,
			}));
		},
	};
}
