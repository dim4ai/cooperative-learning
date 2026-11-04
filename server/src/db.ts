import { Pool } from 'pg';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';

const pool = new Pool({
  host: process.env.PG_HOST || 'localhost',
  port: Number(process.env.PG_PORT) || 5432,
  user: process.env.PG_USER,
  password: process.env.PG_PASSWORD,
  database: process.env.PG_DATABASE,
});

export interface Teacher {
  id: number;
  email: string;
  name: string;
  sessionVersion: number;
}

// The browser turns the password into an auth key (PBKDF2, then HKDF — journalCrypto.ts in
// client-teacher) and only that key comes here; another key from the same password opens the
// journal, and the server never sees either the password or that one. The auth key is already
// 256 random-looking bits, so bcrypt adds little: the protection against guessing is PBKDF2.
const BCRYPT_COST = 12;
const AUTH_V2 = 'v2:'; // password_hash prefix: bcrypt of the auth key; without it — of the password itself
export const isAuthKey = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);

// Never matched by any real key — only so that a login with an unknown email still pays the same
// bcrypt cost as a known one, closing the timing side-channel that would let someone enumerate emails.
const DUMMY_HASH = bcrypt.hashSync(randomBytes(32).toString('hex'), BCRYPT_COST);

const hashAuthKey = async (authKey: string) => AUTH_V2 + await bcrypt.hash(authKey, BCRYPT_COST);

// Logging in bumps session_version, which invalidates every token issued before this login
// (so a shared/leaked password can't keep two sessions alive at once — whoever logs in last wins).
// 'upgrade': the account still has a hash of the plain password (createTeacher) — the client
// sends the password once together with the auth key, and the hash is replaced.
export async function verifyTeacher(email: string, authKey: string, password?: string): Promise<Teacher | 'upgrade' | null> {
  const { rows } = await pool.query(
    'SELECT id, email, name, password_hash, session_version FROM teachers WHERE email = $1',
    [email]
  );
  const row = rows[0];
  const stored: string | undefined = row?.password_hash;
  if (stored && !stored.startsWith(AUTH_V2)) {
    if (typeof password !== 'string') return 'upgrade';
    if (!await bcrypt.compare(password, stored)) return null;
    await pool.query('UPDATE teachers SET password_hash = $1 WHERE id = $2', [await hashAuthKey(authKey), row.id]);
  } else {
    const ok = await bcrypt.compare(authKey, stored?.slice(AUTH_V2.length) ?? DUMMY_HASH);
    if (!row || !ok) return null;
  }
  const { rows: updated } = await pool.query(
    'UPDATE teachers SET session_version = session_version + 1 WHERE id = $1 RETURNING session_version',
    [row.id]
  );
  return { id: row.id, email: row.email, name: row.name, sessionVersion: updated[0].session_version };
}

export async function getTeacherSessionVersion(teacherId: number): Promise<number | null> {
  const { rows } = await pool.query('SELECT session_version FROM teachers WHERE id = $1', [teacherId]);
  return rows[0]?.session_version ?? null;
}

export async function createTeacher(email: string, password: string, name: string): Promise<Teacher> {
  const password_hash = await bcrypt.hash(password, 10);
  const { rows } = await pool.query(
    'INSERT INTO teachers (email, password_hash, name) VALUES ($1, $2, $3) RETURNING id, email, name, session_version AS "sessionVersion"',
    [email, password_hash, name]
  );
  return rows[0];
}

/** Who may show video in a lesson — chosen when it's created, fixed for its whole life */
export type VideoMode = 'all' | 'teacher' | 'none';
export const VIDEO_MODES: readonly VideoMode[] = ['all', 'teacher', 'none'];

export interface Lesson {
  id: number;
  code: string;
  teacherId: number | null;
  videoMode: VideoMode;
}

// Whether lessons.video_mode exists. If adding it failed (no rights on that DB), lessons keep
// working as before — all with video — instead of failing to be created or found.
let hasVideoMode = false;

// Same for the journal table: without it lessons work, only the journal is unavailable
export let hasJournal = false;

/** Schema changes the code relies on; idempotent, run on every start */
export async function migrate(): Promise<void> {
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS teacher_journals (
      teacher_id int PRIMARY KEY REFERENCES teachers(id) ON DELETE CASCADE,
      version int NOT NULL,
      data text NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    )`);
    hasJournal = true;
  } catch (e) {
    console.error('!!! DB migration failed (journal):', e);
  }
  try {
    await pool.query(`ALTER TABLE lessons ADD COLUMN IF NOT EXISTS video_mode text NOT NULL DEFAULT 'all'
      CHECK (video_mode IN ('all', 'teacher', 'none'))`);
  } catch (e) {
    // not the table's owner — fine if someone already added the column
    const { rowCount } = await pool.query(
      `SELECT 1 FROM information_schema.columns WHERE table_name = 'lessons' AND column_name = 'video_mode'`);
    if (!rowCount) throw e;
  }
  hasVideoMode = true;
}

const CODE_CHARS = 'abcdefghjkmnpqrstuvwxyz23456789'; // no 0/o/1/i/l, less error-prone when read aloud

function generateLessonCode(): string {
  let code = '';
  for (let i = 0; i < 10; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return code;
}

export class LessonLimitError extends Error {}

// Lessons a teacher can have in the database at once (codes still valid, i.e. used within 30 days)
export const MAX_LESSONS_PER_TEACHER = Number(process.env.MAX_LESSONS_PER_TEACHER) || 1000;

export async function createLesson(teacherId: number | null = null, videoMode: VideoMode = 'all'): Promise<Lesson> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateLessonCode();
    try {
      // the count check and the insert are one statement, so a burst of requests can't slip past it
      const { rows } = await pool.query(
        `INSERT INTO lessons (code, teacher_id${hasVideoMode ? ', video_mode' : ''})
         SELECT $1, $2${hasVideoMode ? ', $4' : ''}
         WHERE $2::int IS NULL OR (SELECT count(*) FROM lessons
           WHERE teacher_id = $2 AND last_active_at > now() - interval '30 days') < $3
         RETURNING id, code, teacher_id AS "teacherId", ${hasVideoMode ? 'video_mode' : "'all'"} AS "videoMode"`,
        hasVideoMode ? [code, teacherId, MAX_LESSONS_PER_TEACHER, videoMode] : [code, teacherId, MAX_LESSONS_PER_TEACHER]
      );
      if (!rows[0]) throw new LessonLimitError(`teacher ${teacherId} has ${MAX_LESSONS_PER_TEACHER} lessons`);
      return rows[0];
    } catch (err) {
      if ((err as { code?: string }).code === '23505') continue; // code collision, retry
      throw err;
    }
  }
  throw new Error('failed to generate a unique lesson code');
}

// Codes are valid for 30 days of inactivity; older ones are treated as not found.
export async function getLessonByCode(code: string): Promise<Lesson | null> {
  const { rows } = await pool.query(
    `SELECT id, code, teacher_id AS "teacherId", ${hasVideoMode ? 'video_mode' : "'all'"} AS "videoMode" FROM lessons WHERE code = $1 AND last_active_at > now() - interval '30 days'`,
    [code]
  );
  const row = rows[0];
  if (!row) return null;
  await pool.query('UPDATE lessons SET last_active_at = now() WHERE id = $1', [row.id]);
  return row;
}

export async function cleanupExpiredLessons(): Promise<number> {
  const { rowCount } = await pool.query(`DELETE FROM lessons WHERE last_active_at < now() - interval '30 days'`);
  return rowCount ?? 0;
}

// ---------- teacher's journal ----------
// `data` is ciphertext made in the teacher's browser: the server can't read it, it only keeps it.
// A write says which version it was made from, so a stale tab can't overwrite newer data.

export interface JournalRecord { version: number; data: string }

export async function getJournal(teacherId: number): Promise<JournalRecord | null> {
  const { rows } = await pool.query('SELECT version, data FROM teacher_journals WHERE teacher_id = $1', [teacherId]);
  return rows[0] ?? null;
}

/** New version number, or null if the journal has changed since `baseVersion` (0 — there was none) */
export async function saveJournal(teacherId: number, baseVersion: number, data: string): Promise<number | null> {
  const { rows } = await pool.query(
    `INSERT INTO teacher_journals (teacher_id, version, data) VALUES ($1, 1, $3)
     ON CONFLICT (teacher_id) DO UPDATE SET version = teacher_journals.version + 1, data = $3, updated_at = now()
       WHERE teacher_journals.version = $2
     RETURNING version`,
    [teacherId, baseVersion, data]
  );
  return rows[0]?.version ?? null;
}

/** The journal's key is wrapped by the password, so the new hash and the rewrapped journal go in together */
export async function changePassword(
  teacherId: number, currentAuthKey: string, newAuthKey: string, journal: JournalRecord | null,
): Promise<'ok' | 'wrong password' | 'conflict'> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT password_hash FROM teachers WHERE id = $1 FOR UPDATE', [teacherId]);
    const stored: string | undefined = rows[0]?.password_hash;
    if (!stored?.startsWith(AUTH_V2) || !await bcrypt.compare(currentAuthKey, stored.slice(AUTH_V2.length))) {
      await client.query('ROLLBACK');
      return 'wrong password';
    }
    if (hasJournal) {
      const { rows: current } = await client.query('SELECT version FROM teacher_journals WHERE teacher_id = $1 FOR UPDATE', [teacherId]);
      if ((current[0]?.version ?? null) !== (journal?.version ?? null)) {
        await client.query('ROLLBACK');
        return 'conflict';
      }
      if (journal) {
        await client.query('UPDATE teacher_journals SET version = version + 1, data = $1, updated_at = now() WHERE teacher_id = $2', [journal.data, teacherId]);
      }
    }
    await client.query('UPDATE teachers SET password_hash = $1 WHERE id = $2', [await hashAuthKey(newAuthKey), teacherId]);
    await client.query('COMMIT');
    return 'ok';
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
