import { Test } from '@nestjs/testing';
import { ReconciliationController } from './reconciliation.controller';
import { ReconciliationService } from '../services/reconciliation.service';

describe('ReconciliationController', () => {
  let controller: ReconciliationController;
  const service = { getUsageByTraceIds: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      controllers: [ReconciliationController],
      providers: [{ provide: ReconciliationService, useValue: service }],
    }).compile();
    controller = module.get(ReconciliationController);
  });

  it('parses csv trace ids, dedupes, and wraps service result', async () => {
    const traceA = 'a'.repeat(32);
    const traceB = 'b'.repeat(32);
    const rows = [{ trace_id: traceA, calls: 1 }];
    service.getUsageByTraceIds.mockResolvedValue(rows);

    const result = await controller.getUsage({
      trace_ids: `${traceA},${traceB},${traceA}`,
    });

    expect(service.getUsageByTraceIds).toHaveBeenCalledWith([traceA, traceB]);
    expect(result).toEqual({ data: rows });
  });
});
