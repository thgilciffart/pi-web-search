/**
 * pi-web-search — a web search tool for the pi coding agent.
 *
 * Registers one `web_search` tool backed by ten providers
 * (Tavily, Brave, Serper, Exa, Perplexity, You.com, Parallel, Linkup,
 * SearXNG, DuckDuckGo) plus a `/websearch` status command.
 *
 * Configuration: environment variables per provider, or a JSON config file at
 * ~/.pi/agent/web-search/config.json (or .pi/web-search.json in a project).
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { effectiveFallbackOrder, pickDefaultProvider, resolveSettings, type WebSearchSettings } from "./config.js";
import { buildProviders, PROVIDER_ENV_VARS, PROVIDER_ORDER, type ProviderName } from "./providers/index.js";
import { ProviderError, truncate, type SearchProvider, type WebResult } from "./providers/types.js";

const SNIPPET_LIMIT = 500;
const CONTENT_LIMIT = 1_200;
const MAX_RESULTS_HARD_CAP = 20;

interface WebSearchToolDetails {
	provider: string;
	query: string;
	resultCount: number;
	results: Array<Pick<WebResult, "title" | "url" | "snippet" | "published">>;
	fallbackFrom?: string;
}

const SearchParams = Type.Object({
	query: Type.String({ description: "The search query. Be specific; avoid full sentences unless quoting." }),
	provider: Type.Optional(
		StringEnum(PROVIDER_ORDER, {
			description: "Search provider to use. Omit to use the default (first configured provider).",
		}),
	),
	max_results: Type.Optional(
		Type.Number({
			minimum: 1,
			maximum: MAX_RESULTS_HARD_CAP,
			description: "Maximum number of results (default 5).",
		}),
	),
	time_range: Type.Optional(
		StringEnum(["day", "week", "month", "year"] as const, {
			description: "Restrict results to this recency window, when the provider supports it.",
		}),
	),
	include_domains: Type.Optional(
		Type.Array(Type.String(), { description: "Only return results from these domains." }),
	),
	exclude_domains: Type.Optional(
		Type.Array(Type.String(), { description: "Exclude results from these domains." }),
	),
});

const SearchOutput = Type.Object({
	provider: Type.String(),
	query: Type.String(),
	results: Type.Array(
		Type.Object({
			title: Type.String(),
			url: Type.String(),
			snippet: Type.String(),
			published: Type.Optional(Type.String()),
		}),
	),
});

function formatResultsForModel(
	provider: string,
	query: string,
	results: WebResult[],
	notice?: string,
): string {
	const lines: string[] = [];
	if (notice) lines.push(notice);
	if (results.length === 0) {
		lines.push(`No results found for "${query}" (provider: ${provider}).`);
		lines.push("Consider rephrasing the query, widening the time range, or removing domain filters.");
		return lines.join("\n");
	}

	lines.push(`Web search results for "${query}" — provider: ${provider}, ${results.length} result(s):`);
	lines.push("");
	for (let i = 0; i < results.length; i++) {
		const result = results[i];
		lines.push(`[${i + 1}] ${result.title || "(untitled)"}`);
		lines.push(`    ${result.url}`);
		if (result.published) lines.push(`    published: ${result.published}`);
		if (result.snippet) lines.push(`    ${truncate(result.snippet, SNIPPET_LIMIT).replace(/\s*\n\s*/g, " ")}`);
		if (result.content && result.content.length > result.snippet.length) {
			lines.push(`    content: ${truncate(result.content, CONTENT_LIMIT).replace(/\s*\n\s*/g, " ")}`);
		}
		lines.push("");
	}
	return lines.join("\n").trimEnd();
}

function buildToolDescription(settings: WebSearchSettings, configured: Set<string>): string {
	const providerLines = PROVIDER_ORDER.map((name) => {
		const envHint = PROVIDER_ENV_VARS[name].length > 0 ? ` — set ${PROVIDER_ENV_VARS[name][0]}` : " — no key needed";
		const status = configured.has(name) ? "available" : "not configured";
		return `- ${name} (${status})${envHint}`;
	}).join("\n");

	return [
		"Search the web and return a list of results (title, URL, snippet, and extracted content when available).",
		"Use this tool for anything involving current events, recent releases, documentation you are unsure about, or facts beyond your training data.",
		"",
		"Providers:",
		providerLines,
		"",
		"The `provider` parameter is optional: it defaults to the first configured provider and falls back to the next available one on failure.",
	].join("\n");
}

export default function (pi: ExtensionAPI) {
	const settings = resolveSettings();
	const providers = buildProviders(settings.providers);
	const providerByName = new Map(providers.map((p) => [p.name, p]));
	const configuredNames = new Set(providers.map((p) => p.name));
	const defaultProvider = pickDefaultProvider(settings, [...configuredNames]);
	const fallbackOrder = effectiveFallbackOrder(settings);

	/** Runs a search, falling back through configured providers on failure. */
	const runSearch = async (
		provider: ProviderName | undefined,
		args: {
			query: string;
			maxResults: number;
			timeRange?: "day" | "week" | "month" | "year";
			includeDomains?: string[];
			excludeDomains?: string[];
		},
		signal: AbortSignal | undefined,
	): Promise<{ provider: SearchProvider; results: WebResult[]; fallbackFrom?: ProviderName }> => {
		// Explicit provider: honor it exactly. Default: allow up to two fallbacks.
		const chain: ProviderName[] = [];
		if (provider) {
			chain.push(provider);
		} else {
			const primary = defaultProvider ?? "duckduckgo";
			chain.push(primary);
			for (const name of fallbackOrder) {
				if (chain.length >= 3) break;
				if (name !== primary && providerByName.has(name)) chain.push(name);
			}
		}

		let fallbackFrom: ProviderName | undefined;
		const errors: string[] = [];
		for (const name of chain) {
			const candidate = providerByName.get(name);
			if (!candidate) {
				errors.push(`${name}: not configured`);
				continue;
			}
			try {
				const results = await candidate.search(args, signal);
				return { provider: candidate, results, fallbackFrom };
			} catch (error) {
				const message =
					error instanceof ProviderError
						? `${name}: ${error.message}`
						: `${name}: ${error instanceof Error ? error.message : String(error)}`;
				errors.push(message);
				fallbackFrom = fallbackFrom ?? name;
			}
		}
		throw new ProviderError(chain[0] ?? "web-search", errors.join("; ") || "no provider available");
	};

	pi.registerTool({
		name: "web_search",
		label: "Web Search",
		description: buildToolDescription(settings, configuredNames),
		promptSnippet: "Search the web for current information.",
		parameters: SearchParams,
		outputSchema: SearchOutput,
		annotations: {
			readOnlyHint: true,
			destructiveHint: false,
			idempotentHint: false,
			openWorldHint: true,
		},

		async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
			if (!params.query.trim()) {
				return {
					content: [{ type: "text", text: "Error: query must not be empty." }],
					details: { provider: "none", query: "", resultCount: 0, results: [] },
					isError: true,
				};
			}

			// Explicitly requesting an unconfigured provider is a setup problem,
			// not a search failure: tell the model how to fix it.
			if (params.provider && !providerByName.has(params.provider)) {
				const envHint = PROVIDER_ENV_VARS[params.provider];
				return {
					content: [
						{
							type: "text",
							text:
								`Provider "${params.provider}" is not configured. ` +
								(envHint.length
									? `Set ${envHint.join(" or ")} or add it to ~/.pi/agent/web-search/config.json, then restart pi. `
									: "") +
								`Available providers: ${[...configuredNames].join(", ")}.`,
						},
					],
					details: { provider: params.provider, query: params.query, resultCount: 0, results: [] },
					isError: true,
				};
			}

			const maxResults = Math.min(
				Math.floor(params.max_results ?? settings.maxResults ?? 5),
				MAX_RESULTS_HARD_CAP,
			);

			try {
				const { provider, results, fallbackFrom } = await runSearch(
					params.provider,
					{
						query: params.query.trim(),
						maxResults,
						timeRange: params.time_range,
						includeDomains: params.include_domains?.length ? params.include_domains : undefined,
						excludeDomains: params.exclude_domains?.length ? params.exclude_domains : undefined,
					},
					signal,
				);

				const notice = fallbackFrom
					? `Note: ${fallbackFrom} failed; fell back to ${provider.name}.`
					: undefined;

				const details: WebSearchToolDetails = {
					provider: provider.name,
					query: params.query,
					resultCount: results.length,
					results: results.map((r) => ({
						title: r.title,
						url: r.url,
						snippet: truncate(r.snippet, 300),
						published: r.published,
					})),
					fallbackFrom,
				};

				return {
					content: [{ type: "text", text: formatResultsForModel(provider.name, params.query, results, notice) }],
					structuredContent: {
						provider: provider.name,
						query: params.query,
						results: results.map((r) => {
							const item: Record<string, string> = {
								title: r.title,
								url: r.url,
								snippet: truncate(r.snippet, 1_000),
							};
							if (r.published) item.published = r.published;
							return item;
						}),
					},
					details,
				};
			} catch (error) {
				const message =
					error instanceof ProviderError
						? error.message
						: error instanceof Error
							? error.message
							: String(error);
				return {
					content: [
						{
							type: "text",
							text: `Web search failed. ${message}\nTry another provider, or check API keys and network access.`,
						},
					],
					details: { provider: params.provider ?? defaultProvider ?? "unknown", query: params.query, resultCount: 0, results: [] },
					isError: true,
				};
			}
		},

		renderCall(args, theme) {
			let text = theme.fg("toolTitle", theme.bold("web_search ")) + theme.fg("muted", `"${args.query}"`);
			if (args.provider) text += ` ${theme.fg("accent", `[${args.provider}]`)}`;
			if (args.time_range) text += ` ${theme.fg("dim", `(${args.time_range})`)}`;
			return new Text(text, 0, 0);
		},

		renderResult(result, { expanded }, theme) {
			const details = result.details as WebSearchToolDetails | undefined;
			if (!details) {
				const text = result.content[0];
				return new Text(text?.type === "text" ? text.text : "", 0, 0);
			}
			if (details.resultCount === 0) {
				return new Text(theme.fg("warning", "No results"), 0, 0);
			}

			let text =
				theme.fg("success", "✓ ") +
				theme.fg("muted", `${details.resultCount} result(s) via `) +
				theme.fg("accent", details.provider);
			if (details.fallbackFrom) {
				text += theme.fg("dim", ` (fell back from ${details.fallbackFrom})`);
			}

			const display = expanded ? details.results : details.results.slice(0, 3);
			for (const item of display) {
				text += `\n${theme.fg("text", `• ${item.title || item.url}`)}`;
				if (item.snippet) {
					text += `\n  ${theme.fg("dim", truncate(item.snippet, 200))}`;
				}
			}
			if (!expanded && details.results.length > 3) {
				text += `\n${theme.fg("dim", `… ${details.results.length - 3} more`)}`;
			}
			return new Text(text, 0, 0);
		},
	});

	pi.registerCommand("websearch", {
		description: "Show web_search provider status, or run a quick test query",
		handler: async (args, ctx) => {
			const query = (args ?? "").trim();
			const report = (message: string, level: "info" | "error" = "info") => {
				if (ctx.hasUI) {
					ctx.ui.notify(message, level);
				} else {
					// Print/RPC mode: no UI available.
					console.log(message);
				}
			};

			if (!query) {
				const lines: string[] = [];
				for (const name of PROVIDER_ORDER) {
					const configured = configuredNames.has(name);
					const envHint = PROVIDER_ENV_VARS[name][0]
						? ` (${PROVIDER_ENV_VARS[name].join(" | ")})`
						: " (no key needed)";
					const mark = configured ? "✓" : "○";
					lines.push(`${mark} ${name}${configured ? "" : envHint}`);
				}
				lines.push("");
				lines.push(
					`Default provider: ${defaultProvider ?? "none"}. Config files: ${
						settings.configFiles.length ? settings.configFiles.join(", ") : "none found"
					}`,
				);
				report(`Web search providers:\n${lines.join("\n")}`);
				return;
			}

			// Quick test search with the default provider.
			try {
				const { provider, results } = await runSearch(
					undefined,
					{ query, maxResults: 3 },
					undefined,
				);
				const summary = results
					.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}`)
					.join("\n");
				report(
					results.length
						? `[${provider.name}] ${results.length} result(s):\n${summary}`
						: `[${provider.name}] No results`,
				);
			} catch (error) {
				report(
					`Search failed: ${error instanceof Error ? error.message : String(error)}`,
					"error",
				);
			}
		},
	});
}
