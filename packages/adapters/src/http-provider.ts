import { ProviderError } from './provider';

type FetchJsonOptions = {
  fetchImpl: typeof fetch;
  url: string;
  timeoutMs?: number;
  headers?: HeadersInit;
  retryUnauthorized?: () => Promise<HeadersInit>;
};

export async function fetchJson({
  fetchImpl,
  url,
  timeoutMs = 8_000,
  headers,
  retryUnauthorized,
}: FetchJsonOptions): Promise<unknown> {
  const request = async (requestHeaders?: HeadersInit) => {
    try {
      return await fetchImpl(url, {
        ...(requestHeaders ? { headers: requestHeaders } : {}),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'TimeoutError') {
        throw new ProviderError('TIMEOUT', 'Provider request timed out');
      }
      throw new ProviderError('UPSTREAM_ERROR', 'Provider request failed');
    }
  };

  let response = await request(headers);
  if (response.status === 401 && retryUnauthorized)
    response = await request(await retryUnauthorized());

  if (response.status === 429) {
    const retryAfter = response.headers.get('Retry-After');
    const isDeltaSeconds = retryAfter !== null && /^\d+$/.test(retryAfter);
    const isHttpDate = retryAfter !== null && /^[A-Z][a-z]{2},/.test(retryAfter);
    const retryAt = isHttpDate ? Date.parse(retryAfter) : Number.NaN;
    const retryAfterMs = isDeltaSeconds
      ? Number(retryAfter) * 1_000
      : Number.isFinite(retryAt)
        ? Math.max(0, retryAt - Date.now())
        : undefined;
    throw new ProviderError('RATE_LIMITED', 'Provider rate limit reached', retryAfterMs);
  }
  if (response.status === 401)
    throw new ProviderError('AUTH_FAILED', 'Provider authentication failed');
  if (!response.ok)
    throw new ProviderError('UPSTREAM_ERROR', `Provider returned HTTP ${response.status}`);

  try {
    return await response.json();
  } catch {
    throw new ProviderError('INVALID_RESPONSE', 'Provider returned invalid JSON');
  }
}
