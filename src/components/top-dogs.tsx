'use client';

import { type ReactNode, useState } from 'react';
import { Panel, PanelLink, cx } from './ui';

/**
 * This week's top 3, by K/D or by kills: a switch, no page change. The two lists are rendered on the
 * server (player names need the server's name styles) and handed in.
 */
export function TopDogs({ kd, kills }: { kd: ReactNode; kills: ReactNode }) {
  const [by, setBy] = useState<'kd' | 'kills'>('kd');
  return (
    <Panel title="Top dogs" action={<PanelLink href={`/leaderboards?metric=${by}&period=7d`}>Leaderboards</PanelLink>}>
      <div className="mb-3 flex gap-2" role="group" aria-label="Rank by">
        {(['kd', 'kills'] as const).map((k) => (
          <button key={k} type="button" aria-pressed={by === k} onClick={() => setBy(k)} className={cx('pill !py-1 text-sm', by === k && 'pill-on')}>
            {k === 'kd' ? 'K/D' : 'Kills'}
          </button>
        ))}
        <span className="ml-auto self-center text-sm text-muted">This week</span>
      </div>
      {by === 'kd' ? kd : kills}
    </Panel>
  );
}
