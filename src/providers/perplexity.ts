/**
 * Perplexity Search API — https://docs.perplexity.ai
 * POST https://api.perplexity.ai/search (Bearer)
 * Real-time ranked web results, no token costs.
 */

import { fetchJson } from "./http.js";
import { ProviderError, type ProviderConfig, type SearchProvider, type SearchQuery, type WebResult } from "./types.js";

interface PerplexityResult {
	title?: string;
	url?: string;
	snippet?: string;
	date?: string | null;
	last_updated?: string | null;
}

interface PerplexityResponse {
	results?: PerplexityResult[];
	id?: string;
}

export function createPerplexityProvider(config: ProviderConfig): SearchProvider {
	const apiKey = config.apiKey;
	if (!apiKey) {
		throw new ProviderError("perplexity", "missing API key");
	}

	return {
		name: "perplexity",
		label: "Perplexity",
		envVars: ["PERPLEXITY_API_KEY"],

		isConfigured() {
			return Boolean(apiKey);
		},

		async search(query: SearchQuery, signal?: AbortSignal): Promise<WebResult[]> {
			const body: Record<string, unknown> = {
				query: query.query,
				max_results: Math.min(query.maxResults, 20),
				search_context_size: typeof config.contextSize === "string" ? config.contextSize : "low",
			};
			if (typeof config.country === "string" && config.country) body.country = config.country;

			// Allowlist and denylist cannot be mixed; prefer the allowlist.
			if (query.includeDomains?.length) {
				body.search_domain_filter = query.includeDomains;
			} else if (query.excludeDomains?.length) {
				body.search_domain_filter = query.excludeDomains.map((domain) => `-${domain}`);
			}

			const response = await fetchJson<PerplexityResponse>("perplexity", {
				url: "https://api.perplexity.ai/search",
				method: "POST",
				headers: { Authorization: `Bearer ${apiKey}` },
				body,
				signal,
			});

			return (response.results ?? []).map((result) => ({
				title: result.title ?? "",
				url: result.url ?? "",
				snippet: result.snippet ?? "",
				published: result.date ?? result.last_updated ?? undefined,
			}));
		},
	};
}
