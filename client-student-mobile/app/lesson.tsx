import { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { io, Socket } from 'socket.io-client';
import { LiveKitRoom, AudioSession, useLocalParticipant, useRoomContext } from '@livekit/react-native';
import { RoomEvent } from 'livekit-client';
import { SERVER_URL } from '../src/config';
import { WaitingView } from '../src/components/WaitingView';
import { BoardView } from '../src/components/BoardView';
import { IndividualView } from '../src/components/IndividualView';
import { PollBar } from '../src/components/PollBar';
import { CallButton } from '../src/components/CallButton';
import type { Seat } from '../src/components/WaitingView';

type Stage = 'waiting' | 'group' | 'individual' | 'pairs' | 'fours';

interface LessonState {
  stage: Stage;
  timerEndsAt: number | null;
  participants: { id: string; name: string; role: string }[];
}

interface LivekitInfo {
  url: string;
  token: string;
  room: string;
}

interface PollData {
  question: string;
  options: string[];
  myVote: number | null;
}

function MicControl({ enabled }: { enabled: boolean }) {
  const { localParticipant } = useLocalParticipant();
  const room = useRoomContext();

  useEffect(() => {
    const apply = () => localParticipant?.setMicrophoneEnabled(enabled);
    apply();
    room.on(RoomEvent.Connected, apply);
    return () => { room.off(RoomEvent.Connected, apply); };
  }, [enabled, localParticipant, room]);

  return null;
}

const STAGE_LABELS: Record<Stage, string> = {
  waiting: 'Рассадка',
  group: 'Объяснение',
  individual: 'Индивидуальная работа',
  pairs: 'Работа в парах',
  fours: 'Работа в четвёрках',
};

function useTimer(timerEndsAt: number | null) {
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  useEffect(() => {
    if (!timerEndsAt) { setSecondsLeft(null); return; }
    const tick = () => setSecondsLeft(Math.max(0, Math.round((timerEndsAt - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [timerEndsAt]);
  return secondsLeft;
}

export default function LessonScreen() {
  const { name, code } = useLocalSearchParams<{ name: string; code: string }>();

  const socketRef = useRef<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [lessonState, setLessonState] = useState<LessonState>({ stage: 'waiting', timerEndsAt: null, participants: [] });
  const [seats, setSeats] = useState<Seat[]>([]);
  const [livekit, setLivekit] = useState<LivekitInfo | null>(null);
  const [poll, setPoll] = useState<PollData | null>(null);
  const [calling, setCalling] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const [waitingForLesson, setWaitingForLesson] = useState(false);
  const [confirmed, setConfirmed] = useState(false);


  const secondsLeft = useTimer(lessonState.timerEndsAt);

  useEffect(() => {
    if (!name || !code) { router.replace('/'); return; }

    const socket = io(SERVER_URL, {
      auth: { name, role: 'student', lessonId: code },
      autoConnect: false,
    });
    socketRef.current = socket;

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    socket.on('state', (s: LessonState) => {
      setLessonState(s);
      setCalling(false);
      setWaitingForLesson(false);
      setConfirmed(true);
    });
    socket.on('seats', setSeats);
    socket.on('livekit', (info: LivekitInfo) => setLivekit(info));
    socket.on('poll', (data: PollData | null) => setPoll(data));
    socket.on('muted', () => setMicOn(false));
    socket.on('teacherJoined', () => setCalling(false));
    socket.on('lessonError', ({ error }: { error: string }) => {
      if (error === 'lesson not found') {
        setWaitingForLesson(true);
      } else if (error === 'too many attempts') {
        Alert.alert('Слишком много попыток', 'Подождите минуту и попробуйте снова');
        router.replace('/');
      } else if (error === 'too many open lessons') {
        Alert.alert('Занятие сейчас не открыть', 'У учителя слишком много занятий одновременно');
        router.replace('/');
      } else {
        router.replace('/');
      }
    });

    socket.connect();

    AudioSession.startAudioSession().catch(() => {});

    return () => {
      socket.disconnect();
      AudioSession.stopAudioSession().catch(() => {});
      setConfirmed(false);
    };
  }, [name, code]);

  useEffect(() => {
    if (!waitingForLesson) return;
    const id = setInterval(() => { socketRef.current?.connect(); }, 30000);
    return () => clearInterval(id);
  }, [waitingForLesson]);

  function toggleCall() {
    const socket = socketRef.current;
    if (!socket || !livekit) return;
    const next = !calling;
    setCalling(next);
    socket.emit(next ? 'callTeacher' : 'dismissCall', { room: livekit.room });
  }

  function vote(optionIndex: number) {
    socketRef.current?.emit('vote', { optionIndex });
    if (poll) setPoll({ ...poll, myVote: optionIndex });
  }

  const stage = lessonState.stage;

  useEffect(() => {
    setMicOn(stage !== 'group');
  }, [stage]);

  const boardStage = stage === 'group' || stage === 'pairs' || stage === 'fours';
  const boardReadOnly = stage === 'group';

  if (waitingForLesson) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.waitingContainer}>
          <Text style={styles.waitingTitle}>Ждём начала занятия…</Text>
          <Text style={styles.waitingCode}>Код: {code}</Text>
          <Text style={styles.waitingHint}>Проверяем каждые 30 секунд</Text>
          <TouchableOpacity style={styles.waitingButton} onPress={() => socketRef.current?.connect()}>
            <Text style={styles.waitingButtonText}>Проверить сейчас</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.replace('/')}>
            <Text style={styles.waitingChangeCode}>Изменить код</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (!confirmed) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.waitingContainer}>
          <Text style={styles.waitingHint}>Подключаемся к занятию…</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={[styles.dot, { color: connected ? '#27ae60' : '#e74c3c' }]}>●</Text>
        <Text style={styles.stageLabel}>{STAGE_LABELS[stage]}</Text>
        {secondsLeft !== null && (
          <Text style={styles.timer}>{secondsLeft}с</Text>
        )}
        {livekit && (
          <TouchableOpacity onPress={() => setMicOn(v => !v)} style={[styles.micBtn, { backgroundColor: micOn ? '#27ae60' : '#e74c3c' }]}>
            <Text style={styles.micBtnText}>{micOn ? '🎤' : '🔇'}</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Poll */}
      {poll && (
        <PollBar
          question={poll.question}
          options={poll.options}
          myVote={poll.myVote}
          onVote={vote}
        />
      )}

      {/* LiveKit audio (invisible) */}
      {livekit && (
        <LiveKitRoom
          key={livekit.room}
          serverUrl={livekit.url}
          token={livekit.token}
          connect={true}
          audio={false}
          video={false}
        >
          <MicControl enabled={micOn} />
        </LiveKitRoom>
      )}

      {/* Stage content */}
      <View style={styles.content}>
        {stage === 'waiting' && socketRef.current && (
          <WaitingView seats={seats} myName={name ?? ''} socket={socketRef.current} />
        )}

        {boardStage && livekit && (
          <View style={styles.boardWrapper}>
            <BoardView
              myName={name ?? ''}
              room={livekit.room}
              lessonId={code ?? ''}
              readOnly={boardReadOnly}
            />
            {!boardReadOnly && (
              <View style={styles.floatingCall}>
                <CallButton calling={calling} onToggle={toggleCall} />
              </View>
            )}
          </View>
        )}

        {stage === 'individual' && (
          <IndividualView calling={calling} onToggleCall={toggleCall} />
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#fff',
  },
  waitingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 24,
  },
  waitingTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1a1a2e',
  },
  waitingCode: {
    fontSize: 15,
    color: '#666',
  },
  waitingHint: {
    fontSize: 13,
    color: '#999',
  },
  waitingButton: {
    marginTop: 8,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ccc',
  },
  waitingButtonText: {
    fontSize: 14,
    color: '#333',
  },
  waitingChangeCode: {
    fontSize: 13,
    color: '#aaa',
    marginTop: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#f5f5f5',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
    gap: 10,
  },
  dot: {
    fontSize: 14,
    fontWeight: 'bold',
  },
  stageLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1a1a2e',
    flex: 1,
  },
  timer: {
    fontSize: 18,
    fontWeight: '700',
    color: '#e74c3c',
  },
  micBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  micBtnText: {
    fontSize: 18,
  },
  content: {
    flex: 1,
  },
  boardWrapper: {
    flex: 1,
  },
  floatingCall: {
    position: 'absolute',
    bottom: 24,
    right: 20,
  },
});
