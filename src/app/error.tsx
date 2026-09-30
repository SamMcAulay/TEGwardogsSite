'use client';

import { Container } from '@/components/ui';

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <Container className="py-28 text-center">
      <div className="eyebrow">Error</div>
      <h1 className="display mt-3 text-5xl">Something broke</h1>
      <p className="mt-3 text-muted">The page failed to load. It has been logged; trying again usually helps.</p>
      <button
        onClick={reset}
        className="mt-8 bg-accent px-5 py-2.5 font-display text-sm font-bold uppercase tracking-[0.12em] text-accent-ink"
      >
        Try again
      </button>
    </Container>
  );
}
