import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AgentMessage } from '../../entities/agent-message.entity';
import { ReconciliationService } from './reconciliation.service';

describe('ReconciliationService', () => {
  let service: ReconciliationService;
  const qb = {
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(),
    getRawMany: jest.fn(),
  };
  const repo = { createQueryBuilder: jest.fn(() => qb) };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        ReconciliationService,
        { provide: getRepositoryToken(AgentMessage), useValue: repo },
      ],
    }).compile();
    service = module.get(ReconciliationService);
  });

  it('returns empty array without querying when no trace ids given', async () => {
    const result = await service.getUsageByTraceIds([]);
    expect(result).toEqual([]);
    expect(repo.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('aggregates rows and normalizes numeric strings', async () => {
    qb.getRawMany.mockResolvedValue([
      {
        trace_id: 'a'.repeat(32),
        calls: '5',
        ok_calls: '4',
        input_tokens: '1500',
        output_tokens: '300',
        cache_read_tokens: '100',
        cost_usd: '0.012345',
        subscription_calls: '1',
        unpriced_calls: '1',
        models: 'gpt-4-turbo,claude-sonnet',
      },
    ]);

    const result = await service.getUsageByTraceIds(['a'.repeat(32)]);

    expect(qb.where).toHaveBeenCalledWith('at.trace_id IN (:...traceIds)', {
      traceIds: ['a'.repeat(32)],
    });
    expect(result).toEqual([
      {
        trace_id: 'a'.repeat(32),
        calls: 5,
        ok_calls: 4,
        input_tokens: 1500,
        output_tokens: 300,
        cache_read_tokens: 100,
        cost_usd: 0.012345,
        subscription_calls: 1,
        unpriced_calls: 1,
        models: ['gpt-4-turbo', 'claude-sonnet'],
      },
    ]);
  });

  it('handles null aggregates and missing models', async () => {
    qb.getRawMany.mockResolvedValue([
      {
        trace_id: null,
        calls: null,
        ok_calls: null,
        input_tokens: null,
        output_tokens: null,
        cache_read_tokens: null,
        cost_usd: null,
        subscription_calls: null,
        unpriced_calls: null,
        models: null,
      },
    ]);

    const result = await service.getUsageByTraceIds(['b'.repeat(32)]);
    expect(result).toEqual([
      {
        trace_id: '',
        calls: 0,
        ok_calls: 0,
        input_tokens: 0,
        output_tokens: 0,
        cache_read_tokens: 0,
        cost_usd: 0,
        subscription_calls: 0,
        unpriced_calls: 0,
        models: [],
      },
    ]);
  });
});
