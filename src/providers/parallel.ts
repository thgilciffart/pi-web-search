/**
 * Parallel Search API — https://docs.parallel.ai
 * POST https://api.parallel.ai/v1/search (x-api-key)
 * Proprietary web index; ranked URLs with dense LLM-sized excerpts.
 */

import { fetchJson } from "./http.js";
import { ProviderError, type ProviderConfig, type SearchProvider, type SearchQuery, type WebResult } from "./types.js";

interface ParallelResult {
	url: string;
	title?: string | null;
	publish_date?: string | null;
	excerpts: string[];
}

interface ParallelResponse {
	search_id?: string;
	results?: ParallelResult[];
}

const VALID_MODES = new Set(["turbo", "fast", "basic", "advanced"]);

export function createParallelProvider(config: ProviderConfig): SearchProvider {
	const apiKey = config.apiKey;
	if (!apiKey) {
		throw new ProviderError("parallel", "missing API key");
	}

	return {
		name: "parallel",
		label: "Parallel",
		envVars: ["PARALLEL_API_KEY"],

		isConfigured() {
			return Boolean(apiKey);
		},

		async search(query: SearchQuery, signal?: AbortSignal): Promise<WebResult[]> {
			const mode = typeof config.mode === "string" && VALID_MODES.has(config.mode) ? config.mode : "fast";

			const advancedSettings: Record<string, unknown> = {
				max_results: Math.min(query.maxResults, 20),
			};

			// Source policy: include is an allowlist; exclude applies only when include is empty.
			const sourcePolicy: Record<string, unknown> = {};
			if (query.includeDomains?.length) {
				sourcePolicy.include_domains = query.includeDomains;
			} else if (query.excludeDomains?.length) {
				sourcePolicy.exclude_domains = query.excludeDomains;
			}
			if (query.timeRange) {
				const days = query.timeRange === "day" ? 1 : query.timeRange === "week" ? 7 : query.timeRange === "month" ? 30 : 365;
				sourcePolicy.after_date = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
			}
			if (Object.keys(sourcePolicy).length > 0) {
				advancedSettings.source_policy = sourcePolicy;
			}

			const response = await fetchJson<ParallelResponse>("parallel", {
				url: "https://api.parallel.ai/v1/search",
				method: "POST",
				headers: { "x-api-key": apiKey },
				body: {
					// Parallel wants concise keyword queries plus an optional objective.
					search_queries: [query.query],
					objective: query.query,
					mode,
					advanced_settings: advancedSettings,
				},
				signal,
			});

			return (response.results ?? []).map((result) => ({
				title: result.title ?? "",
				url: result.url,
				snippet: result.excerpts?.[0] ?? "",
				content: result.excerpts?.length > 1 ? result.excerpts.join("\n\n") : undefined,
				published: result.publish_date ?? undefined,
			}));
		},
	};
}
