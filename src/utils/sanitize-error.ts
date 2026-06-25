interface SanitizedError {
  type: string;
  message: string;
  stack?: string;
  code?: unknown;
  status?: unknown;
  details?: string;
  shortMessage?: string;
}

const urlPattern = /https?:\/\/[^\s"',)]+/gi;

/**
 * RPC libraries often include full request URLs inside error messages/stacks.
 * Those URLs can contain API keys, so logs should keep only the host.
 */
export function sanitizeError(error: unknown): SanitizedError {
  if (!(error instanceof Error)) {
    return { type: typeof error, message: sanitizeText(String(error)) };
  }

  const record = error as Error & {
    code?: unknown;
    status?: unknown;
    details?: unknown;
    shortMessage?: unknown;
  };

  return {
    type: error.constructor.name,
    message: sanitizeText(error.message),
    stack: error.stack === undefined ? undefined : sanitizeText(error.stack),
    code: record.code,
    status: record.status,
    details: typeof record.details === "string" ? sanitizeText(record.details) : undefined,
    shortMessage: typeof record.shortMessage === "string" ? sanitizeText(record.shortMessage) : undefined
  };
}

function sanitizeText(value: string): string {
  return value.replace(urlPattern, (url) => {
    try {
      const parsed = new URL(url);
      return `${parsed.protocol}//${parsed.hostname}/***`;
    } catch {
      return "https://***/***";
    }
  });
}
