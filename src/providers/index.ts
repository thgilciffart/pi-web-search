/**
 * Provider registry: builds configured provider instances from resolved config,
 * in a stable priority order used for defaults and fallbacks.
 */

import { createBraveProvider } from "./brave.js";
import { createDuckDuckGoProvider } from "./duckduckgo.js";
import { createExaProvider } from "./exa.js";
import { createLinkupProvider } from "./linkup.js";
import { createParallelProvider } from "./parallel.js";
import { createPerplexityProvider } from "./perplexity.js";
import { createSerperProvider } from "./serper.js";
import { createSearxngProvider } from "./searxng.js";
import { createTavilyProvider } from "./tavily.js";
import { createYoucomProvider } from "./youcom.js";
import type { ProviderConfig, SearchProvider } from "./types.js";

export type ProviderName =
	| "tavily"
	| "brave"
	| "serper"
	| "exa"
	| "perplexity"
	| "youcom"
	| "parallel"
	| "linkup"
	| "searxng"
	| "duckduckgo";

/** Default priority for auto-selection and fallback. */
export const PROVIDER_ORDER: readonly ProviderName[] = [
	"tavily",
	"brave",
	"serper",
	"exa",
	"perplexity",
	"youcom",
	"parallel",
	"linkup",
	"searxng",
	"duckduckgo",
];

/** Env vars checked for each provider's API key, in priority order. */
export const PROVIDER_ENV_VARS: Record<ProviderName, readonly string[]> = {
	tavily: ["TAVILY_API_KEY"],
	brave: ["BRAVE_SEARCH_API_KEY", "BRAVE_API_KEY"],
	serper: ["SERPER_API_KEY"],
	exa: ["EXA_API_KEY"],
	perplexity: ["PERPLEXITY_API_KEY"],
	youcom: ["YDC_API_KEY", "YOU_API_KEY", "YOUCOM_API_KEY"],
	parallel: ["PARALLEL_API_KEY"],
	linkup: ["LINKUP_API_KEY"],
	searxng: ["SEARXNG_URL"],
	duckduckgo: [],
};

type ProviderFactory = (config: ProviderConfig) => SearchProvider | null;

const FACTORIES: Record<ProviderName, ProviderFactory> = {
	tavily: (config) => (config.apiKey ? createTavilyProvider(config) : null),
	brave: (config) => (config.apiKey ? createBraveProvider(config) : null),
	serper: (config) => (config.apiKey ? createSerperProvider(config) : null),
	exa: (config) => (config.apiKey ? createExaProvider(config) : null),
	perplexity: (config) => (config.apiKey ? createPerplexityProvider(config) : null),
	youcom: (config) => (config.apiKey ? createYoucomProvider(config) : null),
	parallel: (config) => (config.apiKey ? createParallelProvider(config) : null),
	linkup: (config) => (config.apiKey ? createLinkupProvider(config) : null),
	searxng: (config) => (config.baseUrl ? createSearxngProvider(config) : null),
	duckduckgo: (config) => createDuckDuckGoProvider(config),
};

/**
 * Builds all providers that have credentials configured and are not disabled.
 * Key sources (env var wins over config file) are merged per provider.
 */
export function buildProviders(
	providerConfigs: Partial<Record<ProviderName, ProviderConfig>>,
): SearchProvider[] {
	const providers: SearchProvider[] = [];
	for (const name of PROVIDER_ORDER) {
		const config = providerConfigs[name] ?? {};
		if (config.enabled === false) continue;
		const provider = safeCreate(name, FACTORIES[name], config);
		if (provider) providers.push(provider);
	}
	return providers;
}

function safeCreate(
	name: ProviderName,
	factory: ProviderFactory,
	config: ProviderConfig,
): SearchProvider | null {
	try {
		return factory(config);
	} catch {
		// A provider whose credentials are missing/invalid is simply unavailable.
		return null;
	}
}

/** Human-readable summary of one provider's key sources, for status output. */
export function describeProviderSetup(
	name: ProviderName,
	config: ProviderConfig | undefined,
	envValue: string | undefined,
): string {
	if (envValue) {
		return `env ${PROVIDER_ENV_VARS[name].find((v) => process.env[v]) ?? PROVIDER_ENV_VARS[name][0]}`;
	}
	if (name === "searxng") return config?.baseUrl ? "config file" : "not configured";
	if (name === "duckduckgo") return "no key needed";
	return config?.apiKey ? "config file" : "not configured";
}

