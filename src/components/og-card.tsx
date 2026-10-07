// The 1200×630 preview pictures, drawn by next/og (Satori): inline styles only, and every element
// with more than one child needs display: flex. Colours are the site's tokens from globals.css.
import type { CardModel } from '@/lib/server/card';

const C = {
  bg: '#07090c',
  surface: '#0d1015',
  line: '#1c222b',
  lineStrong: '#29313c',
  text: '#e8ebef',
  muted: '#8d97a5',
  dim: '#5c6674',
  accent: '#f2b33d',
  accentInk: '#1a1204',
};

const label = {
  fontFamily: 'Barlow',
  fontWeight: 700,
  fontSize: 22,
  letterSpacing: 3,
  textTransform: 'uppercase' as const,
  color: C.muted,
};

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: C.bg,
        backgroundImage: `linear-gradient(${C.surface} 1px, transparent 1px), linear-gradient(90deg, ${C.surface} 1px, transparent 1px)`,
        backgroundSize: '48px 48px',
        borderLeft: `12px solid ${C.accent}`,
        padding: '48px 64px 40px 64px',
        fontFamily: 'Inter',
        color: C.text,
      }}
    >
      {children}
    </div>
  );
}

function Brand({ right }: { right?: string | null }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <div style={{ display: 'flex', background: C.accent, color: C.accentInk, fontFamily: 'Barlow', fontWeight: 700, fontSize: 34, padding: '2px 12px' }}>
          TEG
        </div>
        <div style={{ display: 'flex', marginLeft: 16, fontFamily: 'Barlow', fontWeight: 700, fontSize: 30, letterSpacing: 6 }}>WARDOGS</div>
      </div>
      {right && (
        <div style={{ display: 'flex', border: `2px solid ${C.accent}`, padding: '6px 16px', ...label, color: C.accent, fontSize: 26 }}>
          {right}
        </div>
      )}
    </div>
  );
}

function Initials({ name }: { name: string }) {
  const letters = name.replace(/\[[^\]]*\]\s*/g, '').replace(/[^\p{L}\p{N}]/gu, '').slice(0, 2).toUpperCase() || '?';
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 168,
        height: 168,
        background: '#181d25',
        border: `2px solid ${C.lineStrong}`,
        color: C.accent,
        fontFamily: 'Barlow',
        fontWeight: 700,
        fontSize: 72,
      }}
    >
      {letters}
    </div>
  );
}

export function PlayerCardImage({ model, avatar }: { model: CardModel; avatar: string | null }) {
  const nameSize = model.name.length > 24 ? 48 : model.name.length > 16 ? 60 : 72;
  return (
    <Frame>
      <Brand right={model.rank} />
      <div style={{ display: 'flex', alignItems: 'center', marginTop: 44 }}>
        {avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatar} width={168} height={168} alt="" style={{ border: `2px solid ${C.lineStrong}` }} />
        ) : (
          <Initials name={model.name} />
        )}
        <div style={{ display: 'flex', flexDirection: 'column', marginLeft: 40, maxWidth: 860 }}>
          <div style={{ display: 'flex', fontSize: nameSize, fontWeight: 600, lineHeight: 1.1, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', maxWidth: 860 }}>
            {model.name}
          </div>
          <div style={{ display: 'flex', marginTop: 14, fontSize: 28, color: C.muted }}>{model.seen}</div>
        </div>
      </div>
      <div style={{ display: 'flex', marginTop: 'auto', borderTop: `2px solid ${C.line}`, paddingTop: 28 }}>
        {model.stats.map((s, i) => (
          <div key={s.label} style={{ display: 'flex', flexDirection: 'column', flex: 1, paddingLeft: i ? 28 : 0, borderLeft: i ? `2px solid ${C.line}` : 'none' }}>
            <div style={{ display: 'flex', ...label }}>{s.label}</div>
            <div style={{ display: 'flex', marginTop: 6, fontFamily: 'Barlow', fontWeight: 700, fontSize: 64, color: i === 0 ? C.accent : C.text }}>
              {s.value}
            </div>
          </div>
        ))}
      </div>
    </Frame>
  );
}

export function SiteCardImage({ host }: { host: string | null }) {
  return (
    <Frame>
      <Brand />
      <div style={{ display: 'flex', flexDirection: 'column', marginTop: 'auto', marginBottom: 'auto' }}>
        <div style={{ display: 'flex', fontFamily: 'Barlow', fontWeight: 700, fontSize: 96, letterSpacing: 2 }}>STATS &amp; SERVERS</div>
        <div style={{ display: 'flex', marginTop: 16, fontSize: 32, color: C.muted }}>
          Live servers, player profiles, matches and leaderboards.
        </div>
      </div>
      {host && <div style={{ display: 'flex', ...label, color: C.dim }}>{host}</div>}
    </Frame>
  );
}
