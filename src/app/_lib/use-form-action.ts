/**
 * Small client-side form helpers — submit a form, call a server action,
 * then navigate back to the previous URL (or stay put).
 *
 * These are intentionally tiny; the page-level forms import them.
 */
'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';

export function useFormAction<T extends (...args: any[]) => Promise<unknown>>(action: T) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return {
    pending,
    submit: (event: React.FormEvent<HTMLFormElement>, ...args: Parameters<T>) => {
      event.preventDefault();
      const form = event.currentTarget;
      start(async () => {
        await action(...args);
        form.reset();
        router.refresh();
      });
    },
  };
}