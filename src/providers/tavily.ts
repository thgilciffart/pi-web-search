/**
 * Tavily — https://docs.tavily.com
 * POST https://api.tavily.com/search (Bearer auth)
 */

import { fetchJson } from "./http.js";
import { ProviderError, type ProviderConfig, type SearchProvider, type SearchQuery, type WebResult } from "./types.js";

interface TavilyResult {
	title?: string;
	url?: string;
	content?: string;
	raw_content?: string | null;
	score?: number;
	published_date?: string | null;
}

interface TavilyResponse {
	results?: TavilyResult[];
	answer?: string;
}

export function createTavilyProvider(config: ProviderConfig): SearchProvider {
	const apiKey = config.apiKey;
	if (!apiKey) {
		throw new ProviderError("tavily", "missing API key");
	}

	return {
		name: "tavily",
		label: "Tavily",
		envVars: ["TAVILY_API_KEY"],

		isConfigured() {
			return Boolean(apiKey);
		},

		async search(query: SearchQuery, signal?: AbortSignal): Promise<WebResult[]> {
			const body: Record<string, unknown> = {
				query: query.query,
				max_results: Math.min(query.maxResults, 20),
				search_depth: typeof config.searchDepth === "string" ? config.searchDepth : "basic",
				include_published_date: true,
			};
			if (query.timeRange) body.time_range = query.timeRange;
			if (query.includeDomains?.length) body.include_domains = query.includeDomains;
			if (query.excludeDomains?.length) body.exclude_domains = query.excludeDomains;

			const response = await fetchJson<TavilyResponse>("tavily", {
				url: "https://api.tavily.com/search",
				method: "POST",
				headers: { Authorization: `Bearer ${apiKey}` },
				body,
				signal,
			});

			return (response.results ?? []).map((result) => ({
				title: result.title ?? "",
				url: result.url ?? "",
				snippet: result.content ?? "",
				content: result.raw_content ?? undefined,
				published: result.published_date ?? undefined,
				score: result.score,
			}));
		},
	};
}
