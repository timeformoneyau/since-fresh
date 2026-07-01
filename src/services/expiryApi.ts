import Constants from 'expo-constants';

export type Confidence = 'high' | 'medium' | 'low';
export type DateType = 'expiry' | 'best_before' | 'use_by' | 'unknown';

type Field<T> = { value: T | null; confidence: Confidence };

/** Raw shape returned by the proxy (mirrors since-proxy's ExtractedExpiry). */
export type ExtractedExpiry = {
  itemName: Field<string>;
  expiryDate: Field<string>; // ISO YYYY-MM-DD
  dateType: Field<DateType>;
};

export type ParseExpiryResult =
  | { ok: true; fields: ExtractedExpiry }
  | { ok: false; error: string };

function getConfig(): { url: string; secret: string } {
  const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, unknown>;
  return {
    url: typeof extra.expiryApiUrl === 'string' ? extra.expiryApiUrl : '',
    secret: typeof extra.expiryApiSecret === 'string' ? extra.expiryApiSecret : '',
  };
}

export function isExpiryScanningConfigured(): boolean {
  return getConfig().url.length > 0;
}

/**
 * Send a base64 JPEG photo to the since-proxy backend for expiry extraction.
 * Never throws — network/parse failures are returned as { ok: false, error }
 * so the caller can fall back to manual entry, matching the proxy's own
 * graceful-degradation contract.
 */
export async function parseExpiryPhoto(base64Jpeg: string): Promise<ParseExpiryResult> {
  const { url, secret } = getConfig();
  if (!url) {
    return { ok: false, error: 'Photo scanning is not configured.' };
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(secret ? { Authorization: `Bearer ${secret}` } : {}),
      },
      body: JSON.stringify({ imageBase64: base64Jpeg }),
    });

    const body = (await response.json()) as ParseExpiryResult;
    if (!response.ok || !body.ok) {
      const error = !body.ok ? body.error : `Request failed (${response.status}).`;
      return { ok: false, error };
    }
    return body;
  } catch {
    return { ok: false, error: "Couldn't reach the scanner — check your connection and try again." };
  }
}
