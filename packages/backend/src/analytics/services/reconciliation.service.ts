import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AgentMessage } from '../../entities/agent-message.entity';

export interface TraceUsageRow {
  trace_id: string;
  calls: number;
  ok_calls: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cost_usd: number;
  models: string[];
}

/**
 * Aggregates recorded proxy usage per trace id so an external billing system
 * (e.g. the HyCoreAI admin-server) can reconcile client-reported usage
 * against what this proxy actually served.
 */
@Injectable()
export class ReconciliationService {
  constructor(
    @InjectRepository(AgentMessage)
    private readonly messageRepo: Repository<AgentMessage>,
  ) {}

  async getUsageByTraceIds(traceIds: string[]): Promise<TraceUsageRow[]> {
    if (traceIds.length === 0) return [];

    const rows: Array<Record<string, string | null>> = await this.messageRepo
      .createQueryBuilder('at')
      .select('at.trace_id', 'trace_id')
      .addSelect('COUNT(*)', 'calls')
      .addSelect(`COUNT(*) FILTER (WHERE at.status = 'ok')`, 'ok_calls')
      .addSelect('COALESCE(SUM(at.input_tokens), 0)', 'input_tokens')
      .addSelect('COALESCE(SUM(at.output_tokens), 0)', 'output_tokens')
      .addSelect('COALESCE(SUM(at.cache_read_tokens), 0)', 'cache_read_tokens')
      .addSelect('COALESCE(SUM(at.cost_usd), 0)', 'cost_usd')
      .addSelect(`STRING_AGG(DISTINCT at.model, ',')`, 'models')
      .where('at.trace_id IN (:...traceIds)', { traceIds })
      .groupBy('at.trace_id')
      .getRawMany();

    return rows.map((r) => ({
      trace_id: r.trace_id ?? '',
      calls: Number(r.calls ?? 0),
      ok_calls: Number(r.ok_calls ?? 0),
      input_tokens: Number(r.input_tokens ?? 0),
      output_tokens: Number(r.output_tokens ?? 0),
      cache_read_tokens: Number(r.cache_read_tokens ?? 0),
      cost_usd: Number(r.cost_usd ?? 0),
      models: r.models ? r.models.split(',') : [],
    }));
  }
}
