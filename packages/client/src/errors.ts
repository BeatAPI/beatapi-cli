export interface BeatAPIErrorOptions {
  status?: number | undefined;
  code?: string | undefined;
  requestId?: string | undefined;
  retryAfterSeconds?: number | undefined;
  details?: unknown | undefined;
  cause?: unknown | undefined;
}

export class BeatAPIError extends Error {
  readonly status: number | undefined;
  readonly code: string | undefined;
  readonly requestId: string | undefined;
  readonly retryAfterSeconds: number | undefined;
  readonly details: unknown | undefined;

  constructor(message: string, options: BeatAPIErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "BeatAPIError";
    this.status = options.status;
    this.code = options.code;
    this.requestId = options.requestId;
    this.retryAfterSeconds = options.retryAfterSeconds;
    this.details = options.details;
  }
}
