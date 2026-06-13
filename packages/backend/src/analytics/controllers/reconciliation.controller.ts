import { Controller, Get, Query } from '@nestjs/common';
import { ReconciliationQueryDto, parseTraceIds } from '../dto/reconciliation-query.dto';
import { ReconciliationService } from '../services/reconciliation.service';

/**
 * Service-to-service reconciliation endpoint. Authenticated via the env-based
 * X-API-Key (no session user) — deliberately does not use @CurrentUser().
 */
@Controller('api/v1/reconciliation')
export class ReconciliationController {
  constructor(private readonly reconciliation: ReconciliationService) {}

  @Get('usage')
  async getUsage(@Query() query: ReconciliationQueryDto) {
    const traceIds = parseTraceIds(query.trace_ids);
    return { data: await this.reconciliation.getUsageByTraceIds(traceIds) };
  }
}
