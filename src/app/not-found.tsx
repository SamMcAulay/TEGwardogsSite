import Link from 'next/link';
import { Container } from '@/components/ui';

export default function NotFound() {
  return (
    <Container className="py-28 text-center">
      <div className="eyebrow">404 · Off the map</div>
      <h1 className="display mt-3 text-5xl">Nothing here</h1>
      <p className="mt-3 text-muted">That player, server or match does not exist, or has not been recorded yet.</p>
      <div className="mt-8 flex justify-center gap-3">
        <Link
          href="/"
          className="bg-accent px-5 py-2.5 font-display text-sm font-bold uppercase tracking-[0.12em] text-accent-ink"
        >
          Home
        </Link>
        <Link
          href="/players"
          className="border border-line-strong px-5 py-2.5 font-display text-sm font-bold uppercase tracking-[0.12em] hover:border-accent"
        >
          Find a player
        </Link>
      </div>
    </Container>
  );
}
