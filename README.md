# pi-websearch

Web search tool for the [Pi](https://pi.dev) coding agent with one `web_search` tool, 10 providers, automatic fallback, and direct API calls, so a search costs the API price, not model tokens.

## Install

```sh
pi install npm:@thgilciffart/pi-websearch
```

Set a provider's environment variable before starting Pi, or use DuckDuckGo without a key. Run `/reload` after installation in an open session.

```sh
export BRAVE_SEARCH_API_KEY="your-key"
pi
```

Run `/websearch` to check provider status, or `/websearch <query>` for a three-result test search.

## Providers

Automatic selection uses the first configured, enabled provider in this order:

| Provider | Environment variable |
| --- | --- |
| `tavily` | `TAVILY_API_KEY` |
| `brave` | `BRAVE_SEARCH_API_KEY`, alias `BRAVE_API_KEY` |
| `serper` | `SERPER_API_KEY` |
| `exa` | `EXA_API_KEY` |
| `perplexity` | `PERPLEXITY_API_KEY` |
| `youcom` | `YDC_API_KEY`, aliases `YOU_API_KEY`, `YOUCOM_API_KEY` |
| `parallel` | `PARALLEL_API_KEY` |
| `linkup` | `LINKUP_API_KEY` |
| `searxng` | `SEARXNG_URL`, the instance base URL |
| `duckduckgo` | None. Uses an unofficial HTML endpoint that may be rate-limited or blocked. |

## Configure providers

On first run, the extension creates `~/.pi/agent/web-search/config.json` with all providers listed. Existing files remain intact. Project settings in `.pi/web-search.json` override global settings field by field. Environment variables override credentials.

```json
{
	"defaultProvider": "brave",
	"maxResults": 8,
	"providers": {
		"brave": { "apiKey": "your-key" },
		"searxng": { "baseUrl": "http://localhost:8080" },
		"duckduckgo": { "enabled": false }
	}
}
```

| Setting | Effect |
| --- | --- |
| `defaultProvider` | Default provider ID. `"auto"` uses the first available provider. |
| `fallbackOrder` | Provider IDs to prioritize before the built-in order. |
| `maxResults` | Default result count. Defaults to 5, capped at 20. |
| `providers.<id>.enabled` | `false` prevents all use of that provider, including explicit requests. |
| `providers.<id>.apiKey` | Credential when no environment variable supplies one. |

Provider-specific options include `parallel.mode`, `linkup.depth`, `exa.type`, `serper.gl`, `serper.hl`, `perplexity.contextSize`, and `youcom.highlights`. SearXNG uses `baseUrl` instead of `apiKey`.

## Tool reference

| Parameter | Meaning |
| --- | --- |
| `query` | Required search text. |
| `provider` | Provider ID. Omit for automatic selection and fallback. |
| `max_results` | Result count from 1 to 20. Defaults to the configured count. |
| `time_range` | `day`, `week`, `month`, or `year`. Support varies by provider. |
| `include_domains` | Array of domains to include. |
| `exclude_domains` | Array of domains to exclude. |

An automatic search tries at most three providers if requests fail. Naming a provider disables fallback. Cancellation stops retry waits and further fallback requests.

Results include the answering provider and `structuredContent` with `provider`, `query`, and `results`.

## Develop

```sh
bun install
./scripts/link-pi-types.sh
bun run typecheck
bun test
pi -e ./src/index.ts
```

To add a provider, implement `SearchProvider` in `src/providers/` and register it in `src/providers/index.ts`.

[MIT license](LICENSE).
