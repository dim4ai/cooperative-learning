import { Pool } from 'pg';
import bcrypt from 'bcryptjs';

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

// Logging in bumps session_version, which invalidates every token issued before this login
// (so a shared/leaked password can't keep two sessions alive at once — whoever logs in last wins).
export async function verifyTeacher(email: string, password: string): Promise<Teacher | null> {
  const { rows } = await pool.query(
    'SELECT id, email, name, password_hash, session_version FROM teachers WHERE email = $1',
    [email]
  );
  const row = rows[0];
  if (!row) return null;
  const ok = await bcrypt.compare(password, row.password_hash);
  if (!ok) return null;
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

export interface Lesson {
  id: number;
  code: string;
  teacherId: number | null;
}

export interface Student {
  id: number;
  teacherId: number;
  name: string;
}

const CODE_CHARS = 'abcdefghjkmnpqrstuvwxyz23456789'; // no 0/o/1/i/l, less error-prone when read aloud

function generateLessonCode(): string {
  let code = '';
  for (let i = 0; i < 10; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return code;
}

export async function createLesson(teacherId: number | null = null): Promise<Lesson> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateLessonCode();
    try {
      const { rows } = await pool.query(
        'INSERT INTO lessons (code, teacher_id) VALUES ($1, $2) RETURNING id, code, teacher_id AS "teacherId"',
        [code, teacherId]
      );
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
    `SELECT id, code, teacher_id AS "teacherId" FROM lessons WHERE code = $1 AND last_active_at > now() - interval '30 days'`,
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

export async function listStudents(teacherId: number): Promise<Student[]> {
  const { rows } = await pool.query(
    'SELECT id, teacher_id AS "teacherId", name FROM students WHERE teacher_id = $1 ORDER BY name',
    [teacherId]
  );
  return rows;
}

export async function createStudent(teacherId: number, name: string): Promise<Student> {
  const { rows } = await pool.query(
    'INSERT INTO students (teacher_id, name) VALUES ($1, $2) RETURNING id, teacher_id AS "teacherId", name',
    [teacherId, name]
  );
  return rows[0];
}

// Devices can be linked to several students (shared computer), so this returns a list, not one.
export async function getStudentsForDevice(teacherId: number, deviceId: string): Promise<Student[]> {
  const { rows } = await pool.query(
    `SELECT s.id, s.teacher_id AS "teacherId", s.name
     FROM students s
     JOIN student_devices sd ON sd.student_id = s.id
     WHERE s.teacher_id = $1 AND sd.device_id = $2
     ORDER BY s.name`,
    [teacherId, deviceId]
  );
  return rows;
}

export async function linkDevice(studentId: number, deviceId: string): Promise<void> {
  await pool.query(
    'INSERT INTO student_devices (student_id, device_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [studentId, deviceId]
  );
}

export async function unlinkDevice(studentId: number, deviceId: string): Promise<void> {
  await pool.query(
    'DELETE FROM student_devices WHERE student_id = $1 AND device_id = $2',
    [studentId, deviceId]
  );
}
