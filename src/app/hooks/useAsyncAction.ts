"use client";

import { useCallback, useState } from "react";

export interface UseAsyncActionResult<TArgs extends unknown[], TResult> {
  loading: boolean;
  error: Error | null;
  execute: (...args: TArgs) => Promise<TResult | undefined>;
  reset: () => void;
}

export interface UseAsyncActionOptions<TResult> {
  onSuccess?: (result: TResult) => void;
  onError?: (error: Error) => void;
}

export function useAsyncAction<TArgs extends unknown[], TResult>(
  action: (...args: TArgs) => Promise<TResult>,
  options: UseAsyncActionOptions<TResult> = {},
): UseAsyncActionResult<TArgs, TResult> {
  const { onSuccess, onError } = options;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const execute = useCallback(
    async (...args: TArgs): Promise<TResult | undefined> => {
      setLoading(true);
      setError(null);
      try {
        const result = await action(...args);
        onSuccess?.(result);
        return result;
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        setError(e);
        onError?.(e);
        return undefined;
      } finally {
        setLoading(false);
      }
    },
    [action, onSuccess, onError],
  );

  const reset = useCallback(() => {
    setError(null);
  }, []);

  return { loading, error, execute, reset };
}
