import { writeFileSync } from 'fs';

export async function reliableFetch(url, options = {}) {
  const {
    maxRetries = 3,
    initialBackoffMs = 500,
    maxBackoffMs = 10000,
    timeoutMs = 15000,
    ...fetchOptions
  } = options;

  let attempt = 0;

  while (true) {
    const controller = new AbortController();
    let timeoutId;
    
    const onUserAbort = () => controller.abort(fetchOptions.signal?.reason);
    if (fetchOptions.signal) {
      if (fetchOptions.signal.aborted) {
        const err = new Error("Request aborted by user signal");
        err.name = "AbortError";
        throw err;
      }
      fetchOptions.signal.addEventListener('abort', onUserAbort);
    }

    if (timeoutMs) {
      timeoutId = setTimeout(() => {
        const err = new Error('Request Timeout');
        err.name = 'TimeoutError';
        controller.abort(err);
      }, timeoutMs);
    }

    try {
      const currentOptions = { ...fetchOptions, signal: controller.signal };
      const response = await fetch(url, currentOptions);

      if (response.ok) {
        return response;
      }

      const status = response.status;
      const isTransient = status === 429 || (status >= 500 && status <= 504);

      if (!isTransient || attempt >= maxRetries) {
        const error = new Error(`HTTP Error ${status}: ${response.statusText}`);
        error.status = status;
        error.response = response;
        error.retriesExhausted = attempt >= maxRetries;
        throw error;
      }

      let delayMs = Math.min(initialBackoffMs * Math.pow(2, attempt), maxBackoffMs);

      if (status === 429 || status === 503) {
        const retryAfter = response.headers.get("Retry-After");
        if (retryAfter) {
          const parsed = parseInt(retryAfter, 10);
          if (!Number.isNaN(parsed)) {
            delayMs = Math.max(delayMs, parsed * 1000);
          } else {
            const date = new Date(retryAfter);
            if (!Number.isNaN(date.getTime())) {
              delayMs = Math.max(delayMs, date.getTime() - Date.now());
            }
          }
        }
      }

      attempt++;
      await new Promise(resolve => setTimeout(resolve, delayMs));

    } catch (error) {
      if (fetchOptions.signal?.aborted) {
        throw error;
      }

      const isTimeout = error.name === 'TimeoutError' || (error.cause && error.cause.name === 'TimeoutError');
      const isNetwork = !isTimeout && (error.code || error.cause || error.message.toLowerCase().includes('fetch') || error.message.toLowerCase().includes('network'));

      if (attempt >= maxRetries) {
        error.isTimeout = Boolean(isTimeout);
        error.isNetworkError = Boolean(isNetwork);
        error.retriesExhausted = true;
        throw error;
      }

      attempt++;
      const delayMs = Math.min(initialBackoffMs * Math.pow(2, attempt - 1), maxBackoffMs);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      if (fetchOptions.signal) {
        fetchOptions.signal.removeEventListener('abort', onUserAbort);
      }
    }
  }
}
