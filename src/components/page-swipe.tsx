'use client';

import { usePathname } from 'next/navigation';
import { type ReactNode, useState, ViewTransition } from 'react';
import { shouldSwipe } from '@/lib/swipe';

/**
 * Moving to another page swipes the old cards out to the left and the new ones in from the right.
 * Keyed on the pathname only, so filters (query strings) and AutoRefresh's router.refresh() update
 * in place without a swipe.
 */
export function PageSwipe({ children }: { children: ReactNode }) {
  const path = usePathname();
  const [key, setKey] = useState(path);
  if (shouldSwipe(key, path)) setKey(path);
  return (
    <ViewTransition key={key} enter="swipe-in" exit="swipe-out" default="none">
      <div>{children}</div>
    </ViewTransition>
  );
}
