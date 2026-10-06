/**
 * Exa — https://docs.exa.ai
 * POST https://api.exa.ai/search (x-api-key)
 * Neural/semantic search; returns page text or LLM-picked highlights.
 */

import { fetchJson } from "./http.js";
import { ProviderError, type ProviderConfig, type SearchProvider, type SearchQuery, type WebResult } from "./types.js";

interface ExaResult {
	title?: string;
	url?: string;
	publishedDate?: string;
	author?: string;
	text?: string;
	highlights?: string[];
	score?: number;
}

interface ExaResponse {
	results?: ExaResult[];
}

function startDateFor(timeRange: string): string {
	const now = Date.now();
	const days = timeRange === "day" ? 1 : timeRange === "week" ? 7 : timeRange === "month" ? 30 : 365;
	return new Date(now - days * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
}

export function createExaProvider(config: ProviderConfig): SearchProvider {
	const apiKey = config.apiKey;
	if (!apiKey) {
		throw new ProviderError("exa", "missing API key");
	}

	return {
		name: "exa",
		label: "Exa",
		envVars: ["EXA_API_KEY"],

		isConfigured() {
			return Boolean(apiKey);
		},

		async search(query: SearchQuery, signal?: AbortSignal): Promise<WebResult[]> {
			const textMaxCharacters =
				typeof config.maxCharacters === "number" ? config.maxCharacters : 2_000;

			const body: Record<string, unknown> = {
				query: query.query,
				numResults: Math.min(query.maxResults, 20),
				type: typeof config.type === "string" ? config.type : "auto",
				contents: {
					text: { maxCharacters: textMaxCharacters },
				},
			};
			if (query.timeRange) body.startPublishedDate = startDateFor(query.timeRange);
			if (query.includeDomains?.length) body.includeDomains = query.includeDomains;
			if (query.excludeDomains?.length) body.excludeDomains = query.excludeDomains;

			const response = await fetchJson<ExaResponse>("exa", {
				url: "https://api.exa.ai/search",
				method: "POST",
				headers: { "x-api-key": apiKey },
				body,
				signal,
			});

			return (response.results ?? []).map((result) => {
				const text = result.text ?? result.highlights?.join("\n…\n") ?? "";
				return {
					title: result.title ?? "",
					url: result.url ?? "",
					snippet: text,
					content: text.length > 400 ? text : undefined,
					published: result.publishedDate,
					score: result.score,
				};
			});
		},
	};
}
