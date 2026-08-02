export function publicApiError(error: unknown, fallback: string, allowedMessages: readonly string[] = []): string {
  if (error instanceof Error && allowedMessages.includes(error.message)) return error.message;
  return fallback;
}
