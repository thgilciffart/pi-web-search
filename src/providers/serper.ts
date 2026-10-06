/**
 * Serper.dev — https://serper.dev
 * POST https://google.serper.dev/search (X-API-KEY)
 * Returns structured Google SERP data: organic results, knowledge graph, news.
 */

import { fetchJson } from "./http.js";
import { ProviderError, type ProviderConfig, type SearchProvider, type SearchQuery, type WebResult } from "./types.js";

interface SerperOrganic {
	position?: number;
	title?: string;
	link?: string;
	snippet?: string;
	date?: string;
}

interface SerperResponse {
	organic?: SerperOrganic[];
	news?: Array<{ title?: string; link?: string; snippet?: string; date?: string }>;
}

const TBS: Record<string, string> = {
	day: "qdr:d",
	week: "qdr:w",
	month: "qdr:m",
	year: "qdr:y",
};

export function createSerperProvider(config: ProviderConfig): SearchProvider {
	const apiKey = config.apiKey;
	if (!apiKey) {
		throw new ProviderError("serper", "missing API key");
	}

	return {
		name: "serper",
		label: "Serper (Google)",
		envVars: ["SERPER_API_KEY"],

		isConfigured() {
			return Boolean(apiKey);
		},

		async search(query: SearchQuery, signal?: AbortSignal): Promise<WebResult[]> {
			let q = query.query;
			if (query.includeDomains?.length) {
				q = `(${query.includeDomains.map((d) => `site:${d}`).join(" OR ")}) ${q}`;
			}
			for (const domain of query.excludeDomains ?? []) {
				q = `${q} -site:${domain}`;
			}

			const body: Record<string, unknown> = {
				q,
				num: Math.min(query.maxResults, 20),
			};
			if (query.timeRange) body.tbs = TBS[query.timeRange];
			if (typeof config.gl === "string" && config.gl) body.gl = config.gl;
			if (typeof config.hl === "string" && config.hl) body.hl = config.hl;

			const response = await fetchJson<SerperResponse>("serper", {
				url: "https://google.serper.dev/search",
				method: "POST",
				headers: { "X-API-KEY": apiKey },
				body,
				signal,
			});

			const organic = (response.organic ?? []).map((result) => ({
				title: result.title ?? "",
				url: result.link ?? "",
				snippet: result.snippet ?? "",
				published: result.date,
			}));

			// Append news results when there is room, deduplicating by URL.
			if (response.news?.length && organic.length < query.maxResults) {
				const seen = new Set(organic.map((r) => r.url));
				for (const item of response.news) {
					if (organic.length >= query.maxResults) break;
					if (!item.link || seen.has(item.link)) continue;
					seen.add(item.link);
					organic.push({
						title: item.title ?? "",
						url: item.link,
						snippet: item.snippet ?? "",
						published: item.date,
					});
				}
			}

			return organic.slice(0, query.maxResults);
		},
	};
}
