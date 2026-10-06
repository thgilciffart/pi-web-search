/**
 * Linkup — https://docs.linkup.so
 * POST https://api.linkup.so/v1/search (Bearer)
 * Fast French search API; outputType "searchResults" returns ranked text results.
 */

import { fetchJson } from "./http.js";
import { ProviderError, type ProviderConfig, type SearchProvider, type SearchQuery, type WebResult } from "./types.js";

interface LinkupResult {
	name?: string;
	url?: string;
	content?: string;
	type?: string;
}

interface LinkupResponse {
	results?: LinkupResult[];
}

const VALID_DEPTHS = new Set(["flash", "fast", "standard", "deep"]);

export function createLinkupProvider(config: ProviderConfig): SearchProvider {
	const apiKey = config.apiKey;
	if (!apiKey) {
		throw new ProviderError("linkup", "missing API key");
	}

	return {
		name: "linkup",
		label: "Linkup",
		envVars: ["LINKUP_API_KEY"],

		isConfigured() {
			return Boolean(apiKey);
		},

		async search(query: SearchQuery, signal?: AbortSignal): Promise<WebResult[]> {
			const depth = typeof config.depth === "string" && VALID_DEPTHS.has(config.depth) ? config.depth : "fast";

			const body: Record<string, unknown> = {
				q: query.query,
				depth,
				outputType: "searchResults",
			};
			if (query.maxResults) body.maxResults = query.maxResults;
			if (query.includeDomains?.length) body.includeDomains = query.includeDomains;
			else if (query.excludeDomains?.length) body.excludeDomains = query.excludeDomains;
			if (query.timeRange) {
				const days = query.timeRange === "day" ? 1 : query.timeRange === "week" ? 7 : query.timeRange === "month" ? 30 : 365;
				body.fromDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
			}

			const response = await fetchJson<LinkupResponse>("linkup", {
				url: "https://api.linkup.so/v1/search",
				method: "POST",
				headers: { Authorization: `Bearer ${apiKey}` },
				body,
				signal,
			});

			return (response.results ?? [])
				.filter((result) => result.type !== "image")
				.map((result) => ({
					title: result.name ?? "",
					url: result.url ?? "",
					snippet: result.content ?? "",
				}));
		},
	};
}
