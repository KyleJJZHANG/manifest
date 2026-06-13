import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { ReconciliationQueryDto, parseTraceIds } from './reconciliation-query.dto';

describe('ReconciliationQueryDto', () => {
  async function validateTraceIds(trace_ids: unknown) {
    const dto = plainToInstance(ReconciliationQueryDto, { trace_ids });
    return validate(dto);
  }

  it('accepts a single 32-hex id', async () => {
    expect(await validateTraceIds('a'.repeat(32))).toHaveLength(0);
  });

  it('accepts comma-separated ids', async () => {
    expect(await validateTraceIds(`${'a'.repeat(32)},${'b'.repeat(32)}`)).toHaveLength(0);
  });

  it('rejects malformed ids', async () => {
    expect((await validateTraceIds('not-hex')).length).toBeGreaterThan(0);
    expect((await validateTraceIds('')).length).toBeGreaterThan(0);
    expect((await validateTraceIds(`${'a'.repeat(32)},short`)).length).toBeGreaterThan(0);
  });

  it('rejects oversized input', async () => {
    const ids = Array.from({ length: 201 }, () => 'c'.repeat(32)).join(',');
    expect((await validateTraceIds(ids)).length).toBeGreaterThan(0);
  });
});

describe('parseTraceIds', () => {
  it('splits and dedupes', () => {
    const a = 'a'.repeat(32);
    const b = 'b'.repeat(32);
    expect(parseTraceIds(`${a},${b},${a}`)).toEqual([a, b]);
  });
});
