// The names students gave for the teacher. In the lesson a student is known by their nick (it's what
// classmates see, in seats and in video rooms); here, in the teacher's browser, it maps to the real name.
import { createContext, useContext } from 'react';

export const StudentNames = createContext<Record<string, string>>({});

export function useStudentName(identity: string): string {
  return useContext(StudentNames)[identity] ?? identity;
}

export function StudentName({ identity }: { identity: string }) {
  return <>{useStudentName(identity)}</>;
}
