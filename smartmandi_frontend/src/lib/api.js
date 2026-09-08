import axios from 'axios';
import { useCallback, useEffect, useState } from 'react';

/**
 * Normalise an axios failure into { status, message }.
 *
 * The API distinguishes 503 (database unreachable — retryable) from 500 (the
 * query itself is broken). The UI shows those differently, so the status has to
 * survive.
 */
export function toApiError(error) {
  const status = error?.response?.status ?? 0;
  const body = error?.response?.data;

  return {
    status,
    message:
      body?.message ||
      body?.error ||
      (status === 0 ? 'Could not reach the API. Is the backend running on port 5000?' : error.message)
  };
}

/**
 * GET a resource, returning { data, error, loading, reload }.
 *
 * `select` maps the payload before it hits state; pass a stable reference
 * (module scope or useCallback) since it participates in the fetch identity.
 */
export function useApi(url, { select, skip = false } = {}) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(!skip);

  const load = useCallback(async (signal) => {
    setLoading(true);
    setError(null);
    try {
      const res = await axios.get(url, { signal });
      if (res.data?.success === false) throw new Error(res.data.message || res.data.error);
      setData(select ? select(res.data) : res.data.data);
    } catch (err) {
      if (axios.isCancel(err) || err.name === 'CanceledError') return;
      setError(toApiError(err));
    } finally {
      setLoading(false);
    }
  }, [url, select]);

  useEffect(() => {
    if (skip) return undefined;
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load, skip]);

  const reload = useCallback(() => load(), [load]);

  return { data, error, loading, reload };
}

/* -------------------------------------------------------------- formatting */

/** Percentage of a 0–1 score. Returns null for null — never 0. */
export function toPercent(score) {
  return typeof score === 'number' && Number.isFinite(score) ? Math.round(score * 100) : null;
}

/** Render a possibly-null measurement. */
export function fmt(value, { decimals = 0, prefix = '', suffix = '' } = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return `${prefix}${value.toLocaleString('en-IN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  })}${suffix}`;
}

export const money = (v) => fmt(v, { decimals: 2, prefix: '₹' });

export function signed(value, { decimals = 1, suffix = '%' } = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return `${value >= 0 ? '+' : ''}${value.toFixed(decimals)}${suffix}`;
}
