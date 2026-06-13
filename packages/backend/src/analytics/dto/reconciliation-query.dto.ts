import { IsString, Matches, MaxLength } from 'class-validator';

const TRACE_ID_CSV = /^[0-9a-f]{32}(,[0-9a-f]{32})*$/;

/** Up to 200 comma-separated 32-hex trace ids. */
export class ReconciliationQueryDto {
  @IsString()
  @MaxLength(33 * 200)
  @Matches(TRACE_ID_CSV, {
    message: 'trace_ids must be comma-separated 32-hex ids',
  })
  trace_ids!: string;
}

export function parseTraceIds(csv: string): string[] {
  return [...new Set(csv.split(','))];
}
