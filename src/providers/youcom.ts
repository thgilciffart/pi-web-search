/**
 * You.com Web Search API — https://you.com/docs
 * POST https://ydc-index.io/v1/search (X-API-Key)
 * Unified web + news results; optional query-relevant "highlights" extraction.
 */

import { fetchJson } from "./http.js";
import { ProviderError, type ProviderConfig, type SearchProvider, type SearchQuery, type WebResult } from "./types.js";

interface YouWebResult {
	url?: string;
	title?: string;
	description?: string;
	snippets?: string[];
	page_age?: string;
	contents?: {
		highlights?: string[];
		markdown?: string;
	};
}

interface YouNewsResult {
	url?: string;
	title?: string;
	description?: string;
	page_age?: string;
}

interface YouResponse {
	results?: {
		web?: YouWebResult[];
		news?: YouNewsResult[];
	};
	metadata?: {
		query?: string;
		latency?: number;
	};
}

function mapWeb(result: YouWebResult): WebResult {
	const highlights = result.contents?.highlights?.join("\n…\n");
	const snippets = result.snippets?.join("\n…\n");
	const snippet = highlights ?? result.description ?? snippets ?? "";
	return {
		title: result.title ?? "",
		url: result.url ?? "",
		snippet,
		content: snippet.length > 400 ? snippet : undefined,
		published: result.page_age,
	};
}

export function createYoucomProvider(config: ProviderConfig): SearchProvider {
	const apiKey = config.apiKey;
	if (!apiKey) {
		throw new ProviderError("youcom", "missing API key");
	}

	return {
		name: "youcom",
		label: "You.com",
		envVars: ["YDC_API_KEY", "YOU_API_KEY", "YOUCOM_API_KEY"],

		isConfigured() {
			return Boolean(apiKey);
		},

		async search(query: SearchQuery, signal?: AbortSignal): Promise<WebResult[]> {
			const body: Record<string, unknown> = {
				query: query.query,
				count: Math.min(query.maxResults, 100),
			};
			if (query.timeRange) body.freshness = query.timeRange;
			if (typeof config.country === "string" && config.country) body.country = config.country;
			if (typeof config.language === "string" && config.language) body.language = config.language;
			if (query.includeDomains?.length) body.include_domains = query.includeDomains;
			else if (query.excludeDomains?.length) body.exclude_domains = query.excludeDomains;

			// Highlights cost the same $5/1K as plain snippets and are better for agents.
			// Opt out with { "providers": { "youcom": { "highlights": false } } }.
			if (config.highlights !== false) {
				body.extraction = { extraction_mode: "highlights" };
			}

			const response = await fetchJson<YouResponse>("youcom", {
				url: "https://ydc-index.io/v1/search",
				method: "POST",
				headers: { "X-API-Key": apiKey },
				body,
				signal,
			});

			const web = (response.results?.web ?? []).map(mapWeb);
			const news = (response.results?.news ?? []).map((result): WebResult => ({
				title: result.title ?? "",
				url: result.url ?? "",
				snippet: result.description ?? "",
				published: result.page_age,
			}));

			return [...web, ...news].slice(0, query.maxResults);
		},
	};
}
