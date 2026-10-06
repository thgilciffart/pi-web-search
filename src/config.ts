/**
 * Configuration resolution: defaults < ~/.pi/agent/web-search/config.json < .pi/web-search.json < env vars.
 *
 * Example config file:
 * {
 *   "defaultProvider": "brave",
 *   "maxResults": 8,
 *   "providers": {
 *     "brave": { "apiKey": "..." },
 *     "searxng": { "baseUrl": "http://localhost:8080" },
 *     "parallel": { "apiKey": "...", "mode": "advanced" }
 *   }
 * }
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { PROVIDER_ENV_VARS, PROVIDER_ORDER, type ProviderName } from "./providers/index.js";
import type { ProviderConfig, TimeRange } from "./providers/types.js";

export interface WebSearchSettings {
	/** Explicit default provider; when unset, the first configured provider wins. */
	defaultProvider?: string;
	/** Provider order override for auto-selection and fallback. */
	fallbackOrder?: string[];
	/** Default value for max_results (default 5). */
	maxResults?: number;
	/** Per-provider credentials and options. */
	providers: Partial<Record<ProviderName, ProviderConfig>>;
	/** Config file paths that were found, for status output. */
	configFiles: string[];
}

function readJsonFile(path: string): Record<string, unknown> | undefined {
	try {
		if (!existsSync(path)) return undefined;
		const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			return parsed as Record<string, unknown>;
		}
		return undefined;
	} catch {
		return undefined;
	}
}

function isProviderName(value: string): value is ProviderName {
	return (PROVIDER_ORDER as readonly string[]).includes(value);
}

function normalizeProviderConfigs(
	providers: unknown,
): Partial<Record<ProviderName, ProviderConfig>> {
	const result: Partial<Record<ProviderName, ProviderConfig>> = {};
	if (!providers || typeof providers !== "object" || Array.isArray(providers)) return result;
	for (const [name, value] of Object.entries(providers as Record<string, unknown>)) {
		if (!isProviderName(name)) continue;
		if (!value || typeof value !== "object" || Array.isArray(value)) continue;
		const config: ProviderConfig = {};
		for (const [key, option] of Object.entries(value as Record<string, unknown>)) {
			if (
				typeof option === "string" ||
				typeof option === "number" ||
				typeof option === "boolean"
			) {
				config[key] = option;
			}
		}
		result[name] = config;
	}
	return result;
}

/** Reads the API key for a provider from env vars (first hit wins). */
function envApiKey(name: ProviderName): string | undefined {
	for (const envVar of PROVIDER_ENV_VARS[name]) {
		const value = process.env[envVar];
		if (typeof value === "string" && value.trim()) return value.trim();
	}
	return undefined;
}

/**
 * Resolves settings from config files and environment variables.
 * @param cwd project directory checked for .pi/web-search.json
 */
export function resolveSettings(cwd: string = process.cwd()): WebSearchSettings {
	const globalPath = join(homedir(), ".pi", "agent", "web-search", "config.json");
	const projectPath = resolve(cwd, ".pi", "web-search.json");

	const global = readJsonFile(globalPath);
	const project = readJsonFile(projectPath);
	const configFiles = [globalPath, projectPath].filter((p) => existsSync(p));

	const merged: Record<string, unknown> = { ...(global ?? {}), ...(project ?? {}) };

	const settings: WebSearchSettings = {
		providers: {
			...normalizeProviderConfigs(global?.providers),
			...normalizeProviderConfigs(project?.providers),
		},
		configFiles,
	};

	if (typeof merged.defaultProvider === "string") settings.defaultProvider = merged.defaultProvider;
	if (Array.isArray(merged.fallbackOrder)) {
		settings.fallbackOrder = merged.fallbackOrder.filter((v): v is string => typeof v === "string");
	}
	if (typeof merged.maxResults === "number" && merged.maxResults >= 1) {
		settings.maxResults = Math.min(Math.floor(merged.maxResults), 20);
	}

	// Env vars override config-file credentials, and fill in the rest.
	for (const name of PROVIDER_ORDER) {
		const envValue = envApiKey(name);
		if (name === "searxng") {
			const baseUrl = envValue ?? settings.providers.searxng?.baseUrl;
			if (baseUrl) {
				settings.providers.searxng = { ...settings.providers.searxng, baseUrl };
			}
		} else if (envValue) {
			settings.providers[name] = { ...settings.providers[name], apiKey: envValue };
		}
	}

	return settings;
}

/** Effective fallback order: user override first, then built-in priority. */
export function effectiveFallbackOrder(settings: WebSearchSettings): ProviderName[] {
	const order: ProviderName[] = [];
	const candidates = [...(settings.fallbackOrder ?? []), ...PROVIDER_ORDER];
	for (const name of candidates) {
		if (isProviderName(name) && !order.includes(name)) order.push(name);
	}
	return order;
}

/** The provider used when the tool call does not name one. */
export function pickDefaultProvider(
	settings: WebSearchSettings,
	configuredNames: readonly string[],
): ProviderName | undefined {
	const order = effectiveFallbackOrder(settings);
	if (settings.defaultProvider && isProviderName(settings.defaultProvider)) {
		const configured = configuredNames.includes(settings.defaultProvider);
		if (configured || settings.defaultProvider === "duckduckgo") {
			return settings.defaultProvider;
		}
	}
	return order.find((name) => configuredNames.includes(name)) ?? "duckduckgo";
}

export type { TimeRange };
