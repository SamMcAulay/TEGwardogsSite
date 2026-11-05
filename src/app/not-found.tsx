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
          className="pill pill-on  text-sm"
        >
          Home
        </Link>
        <Link
          href="/players"
          className="pill !py-1  text-sm"
        >
          Find a player
        </Link>
      </div>
    </Container>
  );
}
