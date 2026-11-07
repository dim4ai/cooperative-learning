// On the start screen: how students will see the teacher — the name and the picture.
import { useEffect, useRef, useState } from 'react';
import { AVATARS, AvatarPicker, DEFAULT_AVATAR, TEACHER_TITLE_MAX } from './avatars';
import { makeRoundPhoto, sameProfile, setTeacherProfile, useTeacherProfile } from './teacherProfile';
import { updateJournal, useJournal } from './journal';
import type { TeacherProfile } from './teacherProfile';

const linkButton = {
  border: 'none', background: 'transparent', color: '#4a90e2', cursor: 'pointer', fontSize: 13, padding: 0,
} as const;

export function TeacherLookEditor() {
  const profile = useTeacherProfile();
  const [title, setTitle] = useState(profile.title);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  // the journal may bring a newer name once it opens
  useEffect(() => { setTitle(profile.title); }, [profile.title]);

  const save = (patch: Partial<TeacherProfile>) => setTeacherProfile({ ...profile, ...patch });
  const journal = useJournal();
  const saved = journal.status === 'open' ? journal.data?.profile : undefined;
  const unsaved = journal.status === 'open' && !sameProfile(profile, saved);
  const commitTitle = () => { if (title.trim() !== profile.title.trim()) save({ title: title.trim() }); };

  async function onFile(file: File | undefined) {
    setError('');
    if (!file) return;
    try {
      save({ photo: await makeRoundPhoto(file) });
      setPicking(false);
    } catch {
      setError('Не получилось открыть эту картинку');
    }
  }

  const picture = profile.photo ?? (profile.avatar && AVATARS[profile.avatar]) ?? DEFAULT_AVATAR;

  return (
    <div data-testid="teacher-look" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <h3 style={{ margin: 0, textAlign: 'center' }}>Для учеников</h3>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <img src={picture} alt="" data-testid="teacher-look-picture" style={{
          width: 56, height: 56, borderRadius: '50%', flexShrink: 0, objectFit: 'cover', background: '#3498db33',
        }} />
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <input data-testid="teacher-title-input" value={title} maxLength={TEACHER_TITLE_MAX}
            onChange={e => setTitle(e.target.value)} onBlur={commitTitle}
            onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
            placeholder="Имя, например Мария Ивановна"
            style={{ fontSize: 14, padding: 7, borderRadius: 6, border: '1px solid #ccc', minWidth: 0 }} />
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <button data-testid="teacher-photo" onClick={() => fileRef.current?.click()} style={linkButton}>
              {profile.photo ? 'Другое фото' : 'Фото'}
            </button>
            {profile.photo && <button data-testid="teacher-photo-remove" onClick={() => save({ photo: null })} style={linkButton}>Убрать фото</button>}
            <button onClick={() => setPicking(p => !p)} style={linkButton}>{picking ? 'Скрыть картинки' : 'Картинка'}</button>
          </div>
        </div>
      </div>
      <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }}
        onChange={e => { onFile(e.target.files?.[0]); e.target.value = ''; }} />
      {error && <div style={{ color: '#e74c3c', fontSize: 13 }}>{error}</div>}
      {picking && <AvatarPicker value={profile.avatar} onChange={id => { save({ avatar: id, photo: null }); setPicking(false); }} />}
      {unsaved && (
        <button data-testid="profile-save" onClick={() => updateJournal(d => ({ ...d, profile }))} style={{
          padding: '7px 10px', fontSize: 14, borderRadius: 6, border: '1px solid #4a90e2', background: '#fff', color: '#4a90e2', cursor: 'pointer',
        }}>Сохранить в профиль</button>
      )}
      <div style={{ height: 40 }} />
    </div>
  );
}
