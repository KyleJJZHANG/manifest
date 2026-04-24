import { OpencodeGoCatalogService } from './opencode-go-catalog.service';

const BT = String.fromCharCode(96);
const OAI = BT + 'https://opencode.ai/zen/go/v1/chat/completions' + BT;
const ANT = BT + 'https://opencode.ai/zen/go/v1/messages' + BT;
const OAI_SDK = BT + '@ai-sdk/openai-compatible' + BT;
const ANT_SDK = BT + '@ai-sdk/anthropic' + BT;

const SAMPLE_MDX = [
  '---',
  'title: Go',
  'description: Low cost subscription for open coding models.',
  '---',
  '',
  '## Endpoints',
  '',
  '| Model        | Model ID     | Endpoint                                         | AI SDK Package              |',
  '| ------------ | ------------ | ------------------------------------------------ | --------------------------- |',
  `| GLM-5.1      | glm-5.1      | ${OAI} | ${OAI_SDK} |`,
  `| GLM-5        | glm-5        | ${OAI} | ${OAI_SDK} |`,
  `| Kimi K2.5    | kimi-k2.5    | ${OAI} | ${OAI_SDK} |`,
  `| MiMo-V2-Pro  | mimo-v2-pro  | ${OAI} | ${OAI_SDK} |`,
  `| MiMo-V2-Omni | mimo-v2-omni | ${OAI} | ${OAI_SDK} |`,
  `| MiniMax M2.7 | minimax-m2.7 | ${ANT} | ${ANT_SDK} |`,
  `| MiniMax M2.5 | minimax-m2.5 | ${ANT} | ${ANT_SDK} |`,
  '',
].join('\n');

describe('OpencodeGoCatalogService', () => {
  let service: OpencodeGoCatalogService;
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    service = new OpencodeGoCatalogService();
    fetchSpy = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  describe('parse', () => {
    it('extracts every model in the endpoints table', () => {
      const entries = service.parse(SAMPLE_MDX);
      expect(entries.map((e) => e.id)).toEqual([
        'glm-5.1',
        'glm-5',
        'kimi-k2.5',
        'mimo-v2-pro',
        'mimo-v2-omni',
        'minimax-m2.7',
        'minimax-m2.5',
      ]);
    });

    it('keeps the docs display name verbatim', () => {
      const entries = service.parse(SAMPLE_MDX);
      const labels = Object.fromEntries(entries.map((e) => [e.id, e.displayName]));
      expect(labels['glm-5.1']).toBe('GLM-5.1');
      expect(labels['kimi-k2.5']).toBe('Kimi K2.5');
      expect(labels['mimo-v2-omni']).toBe('MiMo-V2-Omni');
      expect(labels['minimax-m2.7']).toBe('MiniMax M2.7');
    });

    it('tags MiniMax rows as anthropic and everything else as openai', () => {
      const entries = service.parse(SAMPLE_MDX);
      const byId = Object.fromEntries(entries.map((e) => [e.id, e.format]));
      expect(byId['glm-5.1']).toBe('openai');
      expect(byId['kimi-k2.5']).toBe('openai');
      expect(byId['mimo-v2-pro']).toBe('openai');
      expect(byId['minimax-m2.5']).toBe('anthropic');
      expect(byId['minimax-m2.7']).toBe('anthropic');
    });

    it('never matches the header row (uppercase model ID column fails regex)', () => {
      // The regex anchors the model-id group on [a-z], so "Model ID" in the
      // header row column does not match. No explicit skip needed.
      const entries = service.parse(SAMPLE_MDX);
      expect(entries.find((e) => e.displayName === 'Model')).toBeUndefined();
      expect(entries.find((e) => e.id === 'model id')).toBeUndefined();
    });

    it('returns an empty array when the table is missing', () => {
      expect(service.parse('# Go\n\nNo table here.')).toEqual([]);
    });

    it('deduplicates if a model appears twice', () => {
      const doubled = SAMPLE_MDX + '\n' + SAMPLE_MDX;
      const entries = service.parse(doubled);
      const ids = entries.map((e) => e.id);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  describe('list', () => {
    it('fetches, parses, and caches the catalog', async () => {
      fetchSpy.mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => SAMPLE_MDX,
      } as Response);

      const first = await service.list();
      expect(first).toHaveLength(7);
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      const second = await service.list();
      expect(second).toBe(first);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('returns the last good result when a later fetch fails', async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => SAMPLE_MDX,
      } as Response);
      const good = await service.list();
      expect(good).toHaveLength(7);

      // Force the success cache to look expired, but keep lastGood populated.
      (service as unknown as { cache: unknown }).cache = null;

      fetchSpy.mockResolvedValueOnce({ ok: false, status: 500 } as Response);
      const afterFailure = await service.list();
      expect(afterFailure).toEqual(good);
    });

    it('backs off after a failure so repeated calls do not hammer the network', async () => {
      // First fetch fails with nothing cached → returns [] and arms the
      // error-backoff window.
      fetchSpy.mockResolvedValueOnce({ ok: false, status: 503 } as Response);
      const first = await service.list();
      expect(first).toEqual([]);
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      // Second call within the backoff window reuses the cached fallback and
      // must NOT reach the network.
      const second = await service.list();
      expect(second).toEqual([]);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('returns [] when there is no prior cache and the fetch 404s', async () => {
      fetchSpy.mockResolvedValue({ ok: false, status: 404 } as Response);
      const result = await service.list();
      expect(result).toEqual([]);
    });

    it('returns [] when the fetch throws an Error and nothing is cached', async () => {
      fetchSpy.mockRejectedValue(new Error('network down'));
      const result = await service.list();
      expect(result).toEqual([]);
    });

    it('returns [] when the fetch throws a non-Error value', async () => {
      // Exercises the String(err) fallback when something non-Error is thrown.
      fetchSpy.mockRejectedValue('raw string failure');
      const result = await service.list();
      expect(result).toEqual([]);
    });

    it('returns [] (not stale empty) when the docs parse to zero rows', async () => {
      fetchSpy.mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => '# Nothing useful here',
      } as Response);
      const result = await service.list();
      expect(result).toEqual([]);
    });
  });
});
