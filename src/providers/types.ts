/**
 * Shared types for all search providers.
 */

/** Time window for filtering results by publication/recency. */
export type TimeRange = "day" | "week" | "month" | "year";

/** Normalized query sent to every provider. */
export interface SearchQuery {
	query: string;
	maxResults: number;
	timeRange?: TimeRange;
	includeDomains?: string[];
	excludeDomains?: string[];
}

/** Normalized result returned by every provider. */
export interface WebResult {
	title: string;
	url: string;
	/** Short summary of the page (typically < 500 chars). */
	snippet: string;
	/** Longer extracted content (highlights, excerpts, page text) when the provider returns it. */
	content?: string;
	/** Publication or last-updated date, as returned by the provider. */
	published?: string;
	/** Relevance score, when the provider returns one. */
	score?: number;
}

/** Provider-specific credentials and options resolved from env vars and config files. */
export interface ProviderConfig {
	/** API key (not required for DuckDuckGo; SearXNG usually runs without one). */
	apiKey?: string;
	/** Base URL override (used by SearXNG, optionally others). */
	baseUrl?: string;
	/** Additional provider-specific settings. */
	[key: string]: unknown;
}

/** A search provider implementation. */
export interface SearchProvider {
	/** Stable id used in the tool's `provider` parameter and config files. */
	readonly name: string;
	/** Human-readable label. */
	readonly label: string;
	/** Environment variables that provide the API key, in priority order. */
	readonly envVars: string[];
	/** Returns true when the provider has everything it needs to run. */
	isConfigured(): boolean;
	/** Executes a search and returns normalized results. */
	search(query: SearchQuery, signal?: AbortSignal): Promise<WebResult[]>;
}

/** Error thrown by providers, carrying provider context and HTTP status. */
export class ProviderError extends Error {
	readonly provider: string;
	readonly status?: number;

	constructor(provider: string, message: string, status?: number) {
		super(message);
		this.name = "ProviderError";
		this.provider = provider;
		this.status = status;
	}
}

/** Truncates a string to `max` characters, appending an ellipsis when cut. */
export function truncate(text: string, max: number): string {
	if (text.length <= max) return text;
	return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

/** Decodes the handful of HTML entities DuckDuckGo and Brave leave in snippets. */
export function decodeHtmlEntities(text: string): string {
	return text
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#x27;|&#39;/g, "'")
		.replace(/&nbsp;/g, " ")
		.replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 10)));
}
