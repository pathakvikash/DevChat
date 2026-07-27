"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface UseResourceResult<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
  setData: (value: T | null | ((prev: T | null) => T | null)) => void;
}

export interface UseResourceOptions {
  enabled?: boolean;
  onError?: (error: Error) => void;
}

export function useResource<T>(
  fetcher: () => Promise<T>,
  deps: ReadonlyArray<unknown> = [],
  options: UseResourceOptions = {},
): UseResourceResult<T> {
  const { enabled = true, onError } = options;
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState<boolean>(enabled);
  const [error, setError] = useState<Error | null>(null);

  const onErrorRef = useRef(onError);
  const fetcherRef = useRef(fetcher);

  useEffect(() => {
    onErrorRef.current = onError;
    fetcherRef.current = fetcher;
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetcherRef.current();
      setData(result);
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      setError(e);
      onErrorRef.current?.(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (enabled) {
      void load();
    }
  }, [enabled, load, ...deps]);

  return { data, loading, error, refetch: load, setData };
}
