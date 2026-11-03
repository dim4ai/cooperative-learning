// GENERATED COPY of client-student/src/avatars.tsx — do not edit here, edit the original and run scripts/sync-slides.sh
// Student avatars: a built-in set of animal pictures (Microsoft Fluent Emoji, MIT — avatars/LICENSE.txt).
// Only the id travels over the network; every client has the same pictures.
// Canonical copy: client-student/src (avatars.tsx + avatars/); scripts/sync-slides.sh copies both
// into client-teacher.
import { createContext, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';

const urls = import.meta.glob('./avatars/*.svg', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

/** avatar id → picture URL */
export const AVATARS: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(urls).map(([path, url]) => [path.slice('./avatars/'.length, -'.svg'.length), url]),
);
/** For anyone who hasn't picked one: a neutral silhouette (avatars/default.svg) */
export const DEFAULT_AVATAR = AVATARS.default;
/** What can be picked — everything but the default */
export const AVATAR_IDS: readonly string[] = Object.keys(AVATARS).filter(id => id !== 'default').sort();

const AVATAR_KEY = 'avatar';

export function loadAvatar(): string | null {
  try {
    const id = localStorage.getItem(AVATAR_KEY);
    return id && AVATARS[id] ? id : null;
  } catch {
    return null;
  }
}

export function saveAvatar(id: string | null) {
  try {
    if (id) localStorage.setItem(AVATAR_KEY, id);
    else localStorage.removeItem(AVATAR_KEY);
  } catch { /* private mode */ }
}

// Who has which avatar in the current lesson: LiveKit identity (= participant name) → avatar id
const AvatarContext = createContext<ReadonlyMap<string, string>>(new Map());

export function AvatarProvider({ participants, children }: {
  participants: readonly { name: string; avatar?: string | null }[];
  children: ReactNode;
}) {
  const map = useMemo(
    () => new Map(participants.filter(p => p.avatar).map(p => [p.name, p.avatar!])),
    [participants],
  );
  return <AvatarContext.Provider value={map}>{children}</AvatarContext.Provider>;
}

/** Picture URL of this participant's avatar — the default one if they didn't pick any */
export function useAvatarUrl(identity: string | null | undefined): string | undefined {
  const map = useContext(AvatarContext);
  if (!identity) return undefined;
  const id = map.get(identity);
  return (id && AVATARS[id]) || DEFAULT_AVATAR;
}

/** Grid to pick an avatar from (or none) */
export function AvatarPicker({ value, onChange }: { value: string | null; onChange: (id: string | null) => void }) {
  const cell = (selected: boolean) => ({
    width: 40, height: 40, padding: 3, borderRadius: 8, cursor: 'pointer', boxSizing: 'border-box' as const,
    border: selected ? '2px solid #4a90e2' : '2px solid transparent',
    background: selected ? '#e7f1fc' : 'transparent',
  });
  return (
    <div role="radiogroup" aria-label="Аватарка" style={{ display: 'flex', flexWrap: 'wrap', gap: 2, justifyContent: 'center' }}>
      <button role="radio" aria-checked={value === null} title="Обычная" onClick={() => onChange(null)} style={cell(value === null)}>
        <img src={DEFAULT_AVATAR} alt="Обычная" style={{ width: '100%', height: '100%', display: 'block' }} />
      </button>
      {AVATAR_IDS.map(id => (
        <button key={id} role="radio" aria-checked={value === id} title={id} onClick={() => onChange(id)} style={cell(value === id)}>
          <img src={AVATARS[id]} alt={id} style={{ width: '100%', height: '100%', display: 'block' }} />
        </button>
      ))}
    </div>
  );
}
