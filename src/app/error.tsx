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
        className="pill pill-on mt-8 text-sm"
      >
        Try again
      </button>
    </Container>
  );
}
