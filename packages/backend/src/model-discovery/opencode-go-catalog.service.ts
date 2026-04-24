import { Injectable, Logger } from '@nestjs/common';

export interface OpencodeGoCatalogEntry {
  /** Bare model ID as listed in the docs (e.g. "glm-5.1"). */
  id: string;
  /** Human-readable display name from the docs (e.g. "GLM-5.1"). */
  displayName: string;
  /** Which upstream API format the model expects. */
  format: 'openai' | 'anthropic';
}

const CATALOG_URL =
  'https://raw.githubusercontent.com/anomalyco/opencode/dev/packages/web/src/content/docs/go.mdx';
const CACHE_TTL_MS = 60 * 60 * 1000;
// After a fetch failure we reuse the last-known-good list for a shorter window
// so a sustained outage does not turn into a per-call retry storm.
const ERROR_BACKOFF_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10_000;

/**
 * Fetches the OpenCode Go model list from the public docs source.
 * OpenCode Go has no /v1/models endpoint, so the canonical list lives
 * in the markdown docs file the website renders from. We parse the
 * Endpoints table and cache the result in memory.
 */
@Injectable()
export class OpencodeGoCatalogService {
  private readonly logger = new Logger(OpencodeGoCatalogService.name);
  private cache: { entries: OpencodeGoCatalogEntry[]; expiresAt: number } | null = null;
  private lastGood: OpencodeGoCatalogEntry[] | null = null;

  async list(): Promise<OpencodeGoCatalogEntry[]> {
    const now = Date.now();
    if (this.cache && this.cache.expiresAt > now) {
      return this.cache.entries;
    }

    try {
      const response = await fetch(CATALOG_URL, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!response.ok) {
        this.logger.warn(`OpenCode Go catalog fetch returned ${response.status}`);
        return this.cacheFallback(now);
      }
      const mdx = await response.text();
      const entries = this.parse(mdx);
      if (entries.length === 0) {
        this.logger.warn('OpenCode Go catalog parsed zero entries — docs format may have changed');
        return this.cacheFallback(now);
      }
      this.cache = { entries, expiresAt: now + CACHE_TTL_MS };
      this.lastGood = entries;
      this.logger.log(`OpenCode Go catalog loaded: ${entries.length} models`);
      return entries;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`OpenCode Go catalog fetch failed: ${message}`);
      return this.cacheFallback(now);
    }
  }

  /**
   * Set a short error-backoff cache so repeated calls during an outage do not
   * hammer the network, then return the last-known-good list (or []).
   */
  private cacheFallback(now: number): OpencodeGoCatalogEntry[] {
    const entries = this.lastGood ?? [];
    this.cache = { entries, expiresAt: now + ERROR_BACKOFF_MS };
    return entries;
  }

  /** Parse the Endpoints markdown table out of the go.mdx source. */
  parse(mdx: string): OpencodeGoCatalogEntry[] {
    const rowRe =
      /\|\s*([A-Za-z][^|]*?)\s*\|\s*([a-z][a-z0-9.-]*)\s*\|\s*`?https:\/\/opencode\.ai\/zen\/go\/v1\/(chat\/completions|messages)`?\s*\|/g;
    const entries: OpencodeGoCatalogEntry[] = [];
    const seen = new Set<string>();
    let match: RegExpExecArray | null;
    while ((match = rowRe.exec(mdx)) !== null) {
      const [, rawName, modelId, endpointSuffix] = match;
      const displayName = rawName.trim();
      // The header row never matches: "Model ID" starts uppercase, failing the
      // lowercase-anchored modelId group. Dash separator rows likewise start
      // with '-', not [A-Za-z]. So any row reaching this point is a data row.
      if (seen.has(modelId)) continue;
      seen.add(modelId);
      entries.push({
        id: modelId,
        displayName,
        format: endpointSuffix === 'messages' ? 'anthropic' : 'openai',
      });
    }
    return entries;
  }

  /** Test hook: clear in-memory state. */
  resetCache(): void {
    this.cache = null;
    this.lastGood = null;
  }
}
