// The lesson recording, as the teacher sees it: a button in the lesson's sidebar, a word on the
// first use, and the list of recordings this browser holds until they are saved and removed.
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { CSSProperties } from 'react';
import { clearJustFinished, currentRecordingId, startRecording, stopRecording, useRecording } from './recording';
import { buildDownloads, deleteRecording, download, hasJournalNames, listRecordings, type RecordingMeta } from './recStore';

const NOTICE_KEY = 'recordingNoticeSeen';

const overlay: CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000,
  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
};
const dialog: CSSProperties = {
  background: '#fff', color: '#222', borderRadius: 10, padding: 20, width: 460, maxWidth: '100%', maxHeight: '90vh',
  overflow: 'auto', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 12, fontFamily: 'sans-serif', textAlign: 'left',
};
const mainBtn: CSSProperties = { padding: '9px 12px', borderRadius: 6, border: 'none', color: '#fff', fontSize: 14, cursor: 'pointer', background: '#4a90e2' };
const plainBtn: CSSProperties = { border: 'none', background: 'transparent', color: '#888', cursor: 'pointer', fontSize: 13, padding: 2 };
const text: CSSProperties = { fontSize: 14, lineHeight: 1.45, color: '#333', margin: 0 };

const pad = (n: number) => String(n).padStart(2, '0');
const duration = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return s >= 3600 ? `${Math.floor(s / 3600)}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}` : `${Math.floor(s / 60)}:${pad(s % 60)}`;
};

function seenNotice(): boolean {
  try { return localStorage.getItem(NOTICE_KEY) === '1'; } catch { return false; }
}

// ---------- the list of recordings ----------

// One list for every place that shows it; read again whenever a recording starts, stops or is removed
let cache: RecordingMeta[] = [];
const subscribers = new Set<() => void>();
function refreshList() {
  listRecordings().then(l => { cache = l; subscribers.forEach(f => f()); }).catch(() => {});
}

function useRecordings(): RecordingMeta[] {
  const list = useSyncExternalStore(cb => { subscribers.add(cb); return () => { subscribers.delete(cb); }; }, () => cache);
  const { recording, justFinished } = useRecording();
  useEffect(refreshList, [recording, justFinished]);
  return list;
}

export function RecordingsDialog({ highlight, onClose }: { highlight?: string | null; onClose: () => void }) {
  const list = useRecordings();
  const { recording } = useRecording();
  return (
    <div onClick={onClose} style={overlay}>
      <div role="dialog" aria-label="Записи уроков" data-testid="recordings" onClick={e => e.stopPropagation()} style={dialog}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <h3 style={{ margin: 0, flex: 1 }}>Записи уроков</h3>
          <button onClick={onClose} aria-label="Закрыть" style={{ ...plainBtn, fontSize: 18 }}>✕</button>
        </div>
        <p style={{ ...text, fontSize: 13, color: '#666' }}>
          Записи хранятся только в этом браузере. «Сохранить» скачивает два файла: видео экрана и архив со звуком и действиями учеников. Сохранив, удалите запись отсюда — она занимает место на диске.
        </p>
        <p style={{ ...text, fontSize: 13, color: '#666' }}>
          Посмотреть урок глазами любого ученика — в проигрывателе <a href="https://player.co-learn.ru" target="_blank" rel="noreferrer">player.co-learn.ru</a>: откройте в нём сохранённые файлы.
        </p>
        {list.length === 0 && <div style={{ fontSize: 14, color: '#888' }}>Записей нет</div>}
        {list.map(m => <RecordingRow key={m.id} meta={m} fresh={m.id === highlight} current={recording && m.id === currentRecordingId()} />)}
      </div>
    </div>
  );
}

function RecordingRow({ meta, fresh, current }: { meta: RecordingMeta; fresh: boolean; current: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saved, setSaved] = useState(false);
  const [withoutJournal, setWithoutJournal] = useState(false);
  const length = meta.recordEnd ? duration(meta.recordEnd - meta.recordStart) : null;
  const when = new Date(meta.createdAt).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });

  async function save() {
    setBusy(true);
    setError('');
    try {
      const files = await buildDownloads(meta, { withoutJournal });
      if (files.video) download(files.video.name, files.video.blob);
      // two downloads at once are sometimes held back by the browser: the second one a moment later
      setTimeout(() => download(files.archive.name, files.archive.blob), files.video ? 800 : 0);
      setSaved(true);
    } catch (e) {
      console.warn('recording save:', e);
      setError('Не получилось собрать файлы. Попробуйте ещё раз');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div data-testid="recording-row" style={{
      border: `1px solid ${fresh ? '#4a90e2' : '#e3e3e3'}`, borderRadius: 8, padding: 12, display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      <div style={{ fontSize: 14 }}>
        <b>{meta.title || 'Урок'}</b> · {when}{length && ` · ${length}`}
      </div>
      <div style={{ fontSize: 12, color: '#777' }}>
        {current ? 'Идёт запись'
          : !meta.finished ? 'Запись оборвалась (закрылась вкладка) — записанное до этого сохранится'
          : [meta.video ? 'экран' : 'без экрана', meta.lessons.length ? 'звук и действия' : 'урок не начинался — звука и действий нет'].join(' · ')}
      </div>
      {error && <div style={{ fontSize: 13, color: '#e74c3c' }}>{error}</div>}
      {!current && (confirmDelete ? (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, color: '#555', flex: 1 }}>{saved ? 'Удалить из браузера?' : 'Запись не сохранена. Удалить навсегда?'}</span>
          <button data-testid="recording-delete-yes" onClick={() => deleteRecording(meta.id).then(() => refreshList())} style={{ ...mainBtn, background: '#e74c3c', padding: '6px 12px' }}>Удалить</button>
          <button onClick={() => setConfirmDelete(false)} style={plainBtn}>Отмена</button>
        </div>
      ) : (<>
        {hasJournalNames(meta) && (
          <label style={{ display: 'flex', gap: 6, alignItems: 'flex-start', fontSize: 13, color: '#444', cursor: 'pointer' }}>
            <input type="checkbox" data-testid="recording-no-journal" checked={withoutJournal} onChange={e => setWithoutJournal(e.target.checked)} style={{ marginTop: 2 }} />
            <span>Без имён из журнала: в архиве останутся только ники учеников. <span style={{ color: '#888' }}>Видео экрана так не обезличить — в нём то, что было у вас на экране</span></span>
          </label>
        )}
        <div style={{ display: 'flex', gap: 8 }}>
          <button data-testid="recording-save" onClick={save} disabled={busy} style={{ ...mainBtn, flex: 1 }}>
            {busy ? 'Готовим файлы…' : saved ? 'Сохранить ещё раз' : 'Сохранить'}
          </button>
          <button data-testid="recording-delete" onClick={() => setConfirmDelete(true)} style={{ ...mainBtn, background: '#fff', color: '#e74c3c', border: '1px solid #e74c3c' }}>Удалить</button>
        </div>
      </>))}
    </div>
  );
}

/** «Записи (2)» — only when this browser holds some */
export function RecordingsLink({ style }: { style?: CSSProperties }) {
  const list = useRecordings();
  const [open, setOpen] = useState(false);
  if (!list.length) return null;
  const broken = list.some(m => !m.finished);
  return (<>
    <button data-testid="recordings-open" onClick={() => setOpen(true)} style={{ ...plainBtn, color: broken ? '#c0392b' : '#4a90e2', fontSize: 13, ...style }}>
      Записи уроков ({list.length}){broken ? ' — есть оборванная' : ''}
    </button>
    {open && <RecordingsDialog onClose={() => { setOpen(false); refreshList(); }} />}
  </>);
}

// ---------- in the lesson ----------

export function RecordButton({ title, code, clockSkew, style }: { title: string; code: string; clockSkew: number; style?: CSSProperties }) {
  const rec = useRecording();
  const [notice, setNotice] = useState(false);
  const [now, setNow] = useState(0); // ticks while recording; the first second shows 0:00
  const [stopping, setStopping] = useState(false);
  useEffect(() => {
    if (!rec.recording) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [rec.recording]);

  const begin = () => {
    startRecording({ title, code, clockSkew, withScreen: true }).catch(e => console.warn('recording start:', e));
  };
  const stop = async () => {
    setStopping(true);
    try {
      await stopRecording(); // RecordingFinished offers to save it
    } finally {
      setStopping(false);
    }
  };

  const status = !rec.recording ? null
    : rec.lessonLive ? 'Звук и действия пишутся'
    : 'Звук и действия — с «Начать урок»';

  return (<>
    {rec.recording ? (
      <button data-testid="record-stop" onClick={stop} disabled={stopping} style={{
        padding: '7px 6px', borderRadius: 6, border: 'none', cursor: 'pointer', background: '#c0392b', color: '#fff',
        fontWeight: 'bold', fontSize: 13, ...style,
      }}>{stopping ? 'Сохраняем…' : `⏹ ${duration(now - rec.startedAt)}`}</button>
    ) : (
      <button data-testid="record-start" onClick={() => (seenNotice() ? begin() : setNotice(true))} style={{
        padding: '7px 6px', borderRadius: 6, border: '1px solid #c9b99c', cursor: 'pointer', background: '#fff', color: '#333',
        fontSize: 13, ...style,
      }}><span style={{ color: '#e74c3c' }}>●</span> Записать урок</button>
    )}
    {status && (
      <div data-testid="record-status" style={{ fontSize: 11, color: '#555', marginTop: 4, lineHeight: 1.3 }}>
        {rec.video === 'on' ? 'Экран пишется' : rec.video === 'stopped' ? 'Экран остановлен' : 'Без экрана'}<br />{status}
      </div>
    )}
    {!rec.recording && <RecordingsLink style={{ marginTop: 4, fontSize: 11 }} />}
    {notice && (
      <div onClick={() => setNotice(false)} style={overlay}>
        <div role="dialog" aria-label="Запись урока" onClick={e => e.stopPropagation()} style={dialog}>
          <h3 style={{ margin: 0 }}>Запись урока</h3>
          <p style={text}>Экран (эта вкладка или то, что вы выберете) записывается с этой минуты и до «Остановить». Звук всех комнат и действия учеников — только от «Начать урок» до конца урока.</p>
          <p style={text}>Записи хранятся только на вашем компьютере, на сервер они не попадают. Вы отвечаете за их хранение и распространение: если запись нужна не только вам, получите согласие учеников или их родителей.</p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button data-testid="record-notice-ok" onClick={() => {
              try { localStorage.setItem(NOTICE_KEY, '1'); } catch { /* asked again next time */ }
              setNotice(false);
              begin();
            }} style={{ ...mainBtn, flex: 1 }}>Понятно, записывать</button>
            <button onClick={() => setNotice(false)} style={plainBtn}>Отмена</button>
          </div>
        </div>
      </div>
    )}
  </>);
}

/** Right after a recording stops — by the button, or by leaving the lesson — the list opens with it */
export function RecordingFinished() {
  const { justFinished } = useRecording();
  if (!justFinished) return null;
  return <RecordingsDialog highlight={justFinished} onClose={clearJustFinished} />;
}
