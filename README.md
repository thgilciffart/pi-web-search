# pi-websearch

A [pi](https://github.com/earendil-works/pi) extension that gives the coding agent a `web_search` tool. The tool supports ten search providers. It selects a provider automatically, and it retries with another provider when one fails.

The tool calls each search API directly. A search costs the API price, not model tokens. This differs from provider-native search plugins, which route the search through the LLM provider.

```
┌─ web_search "latest TypeScript version" [tavily]
└─ ✓ 5 result(s) via tavily
   • TypeScript 5.9: The Official Release Date and New Features
     TypeScript 5.9 is here, so let's explore all of the new features…
   • Announcing TypeScript 5.9 - TypeScript
   … 3 more
```

## Providers

| Provider | API key env var | Notes |
|---|---|---|
| `tavily` | `TAVILY_API_KEY` | AI-optimized search, 1,000 free credits/month |
| `brave` | `BRAVE_SEARCH_API_KEY` | Independent index, $5/1K requests, $5 free credits/month |
| `serper` | `SERPER_API_KEY` | Google SERP data, cheapest paid option ($0.30–1/1K), 2,500 free queries |
| `exa` | `EXA_API_KEY` | Neural/semantic search, returns page text |
| `perplexity` | `PERPLEXITY_API_KEY` | Perplexity Search API, $5/1K flat |
| `youcom` | `YDC_API_KEY` | You.com Web Search API, web + news, query-relevant highlights |
| `parallel` | `PARALLEL_API_KEY` | Proprietary index, low latency, dense excerpts |
| `linkup` | `LINKUP_API_KEY` | Fast web search, EU-based |
| `searxng` | `SEARXNG_URL` | Self-hosted metasearch. Set the instance base URL. |
| `duckduckgo` | — | No key needed. Unofficial HTML endpoint, best effort. Some networks may rate-limit it or show a bot challenge. |

Every provider is optional. The tool works with any subset. When you set no key, the tool uses DuckDuckGo.

## Installation

```bash
# from npm (also listed at https://pi.dev/packages)
pi install npm:@thgilciffart/pi-websearch

# from this repo
pi install git:github.com/thgilciffart/pi-web-search

# or from a local checkout
pi install ./pi-web-search
```

Then set at least one API key (see table above) and restart pi. Verify with:

```
/websearch
```

## Configuration

### Environment variables

Set the env var for each provider you want enabled (see table). Env vars override config-file credentials.

### Config file

On first run the extension creates `~/.pi/agent/web-search/config.json` with every provider pre-populated, so all options are visible and editable without digging through docs. Existing files are never overwritten. A `.pi/web-search.json` file in the project takes precedence over the global file:

```json
{
	"defaultProvider": "brave",
	"maxResults": 8,
	"providers": {
		"tavily": { "enabled": true, "apiKey": "tvly-..." },
		"brave": { "enabled": true, "apiKey": "BSA-..." },
		"searxng": { "enabled": true, "baseUrl": "http://localhost:8080" },
		"parallel": { "enabled": true, "apiKey": "...", "mode": "advanced" },
		"linkup": { "enabled": false, "apiKey": "..." },
		"youcom": { "apiKey": "...", "highlights": false },
		"exa": { "apiKey": "...", "type": "fast" },
		"serper": { "apiKey": "...", "gl": "us", "hl": "en" },
		"perplexity": { "apiKey": "...", "contextSize": "medium" }
	}
}
```

- `enabled` — set to `false` to disable a provider. A disabled provider is never used, even when an API key is present (in the config file or in an environment variable).
- `defaultProvider` — the provider the tool uses when a call does not name one. Defaults to the first enabled provider that has a key, in table order. Leave it as `"auto"` (the generated default) to keep automatic selection.
- `fallbackOrder` — array of provider names that controls auto-selection and retry order. Disabled providers are omitted.
- `maxResults` — default result count (default 5, max 20).
- Per-provider extras: `parallel.mode` (`turbo`/`fast`/`basic`/`advanced`), `linkup.depth` (`flash`/`fast`/`standard`/`deep`), `exa.type`, `serper.gl`/`serper.hl` (locale), `perplexity.contextSize`, `youcom.highlights`.

## The `web_search` tool

Parameters:

| Parameter | Type | Description |
|---|---|---|
| `query` | string | The search query |
| `provider` | string | Optional provider id (see table). Omit for the default. |
| `max_results` | number | 1–20, default 5 |
| `time_range` | string | `day`, `week`, `month`, or `year` (provider-dependent) |
| `include_domains` | string[] | Restrict results to these domains |
| `exclude_domains` | string[] | Exclude these domains |

Behavior:

- **Retry** — when a call does not name a provider and the default provider fails, the tool retries with the next configured providers. It tries at most three providers in total. The result names the provider that answered.
- **Explicit provider** — a named provider disables retry. When the named provider is not configured or is disabled, the result explains how to enable it.
- **Disabled providers** — a provider with `"enabled": false` is never selected, never used as a fallback, and rejected when named explicitly.
- **Structured output** — results carry a `structuredContent` payload (`provider`, `query`, `results[]`) for codemode/programmatic callers.

## The `/websearch` command

- `/websearch` — status: which providers are available, not configured, or disabled, the default provider, and config file locations.
- `/websearch <query>` — runs a quick 3-result test search with the default provider.

## Development

```bash
bun install
./scripts/link-pi-types.sh   # once: link pi's host packages for typechecking
bun run typecheck
bun test
```

The extension is plain TypeScript. Pi loads it through its jiti runtime, so you need no build step. Try it live:

```bash
pi -e ./src/index.ts
```

### Adding a provider

1. Create `src/providers/<name>.ts` exporting a factory that returns a `SearchProvider` (see `src/providers/types.ts`).
2. Register it in `src/providers/index.ts`: add the name to `ProviderName`, `PROVIDER_ORDER`, `PROVIDER_ENV_VARS`, and `FACTORIES`.

## License

MIT
