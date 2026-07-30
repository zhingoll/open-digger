export type PublicErrorCode = 'invalid_request' | 'unauthorized' | 'rate_limited' | 'not_found' | 'method_not_allowed' | 'service_unavailable' | 'internal_error';

export interface PublicErrorBody {
  error: { code: PublicErrorCode; message: string };
}

export class DataGatewayError extends Error {
  readonly code: PublicErrorCode;
  readonly status: number;

  constructor(code: PublicErrorCode, message: string, status: number) {
    super(message);
    this.name = 'DataGatewayError';
    this.code = code;
    this.status = status;
  }
}

export function publicError(error: unknown): { status: number; body: PublicErrorBody } {
  if (error instanceof DataGatewayError) {
    return { status: error.status, body: { error: { code: error.code, message: error.message } } };
  }
  return {
    status: 500,
    body: { error: { code: 'internal_error', message: 'The data service encountered an internal error' } },
  };
}
