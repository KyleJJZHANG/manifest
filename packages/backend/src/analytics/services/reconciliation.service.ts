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
  /** Sum of metered cost_usd. Excludes subscription (0) and unpriced (null) calls. */
  cost_usd: number;
  /** Calls served by a subscription (auth_type='subscription') — zero marginal cost, but the subscription has a real fixed fee to amortize. */
  subscription_calls: number;
  /** Calls with no cost_usd (api_key but missing pricing) — cost is unknown, not free. */
  unpriced_calls: number;
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
      // Only sum metered cost; subscription is 0 and unpriced is NULL — keep them
      // out of the sum and count them separately so $0 isn't conflated with "free".
      .addSelect(`COALESCE(SUM(at.cost_usd) FILTER (WHERE at.cost_usd > 0), 0)`, 'cost_usd')
      .addSelect(`COUNT(*) FILTER (WHERE at.auth_type = 'subscription')`, 'subscription_calls')
      .addSelect(
        `COUNT(*) FILTER (WHERE at.cost_usd IS NULL AND COALESCE(at.auth_type, '') <> 'subscription')`,
        'unpriced_calls',
      )
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
      subscription_calls: Number(r.subscription_calls ?? 0),
      unpriced_calls: Number(r.unpriced_calls ?? 0),
      models: r.models ? r.models.split(',') : [],
    }));
  }
}
