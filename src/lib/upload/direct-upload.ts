export interface PutFileRetryOptions {
  fetcher?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  maxAttempts?: number;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function putFileWithRetry(
  url: string,
  body: Blob,
  contentType: string,
  options: PutFileRetryOptions = {},
): Promise<Response> {
  const fetcher = options.fetcher ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const maxAttempts = options.maxAttempts ?? 3;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await fetcher(url, {
        method: 'PUT',
        headers: { 'Content-Type': contentType },
        body,
      });
    } catch (error) {
      const canRetry = error instanceof TypeError && attempt < maxAttempts - 1;
      if (!canRetry) throw error;
      await sleep(250 * 2 ** attempt);
    }
  }

  throw new Error('Upload attempts exhausted.');
}
