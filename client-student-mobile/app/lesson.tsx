import { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { io, Socket } from 'socket.io-client';
import { LiveKitRoom, AudioSession } from '@livekit/react-native';
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
  const { name } = useLocalSearchParams<{ name: string }>();

  const socketRef = useRef<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [lessonState, setLessonState] = useState<LessonState>({ stage: 'waiting', timerEndsAt: null, participants: [] });
  const [seats, setSeats] = useState<Seat[]>([]);
  const [livekit, setLivekit] = useState<LivekitInfo | null>(null);
  const [poll, setPoll] = useState<PollData | null>(null);
  const [calling, setCalling] = useState(false);

  const secondsLeft = useTimer(lessonState.timerEndsAt);

  useEffect(() => {
    if (!name) { router.replace('/'); return; }

    const socket = io(SERVER_URL, {
      auth: { name, role: 'student' },
      autoConnect: false,
    });
    socketRef.current = socket;

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    socket.on('state', (s: LessonState) => {
      setLessonState(s);
      setCalling(false);
    });
    socket.on('seats', setSeats);
    socket.on('livekit', (info: LivekitInfo) => setLivekit(info));
    socket.on('poll', (data: PollData | null) => setPoll(data));
    socket.on('teacherJoined', () => setCalling(false));

    socket.connect();

    AudioSession.startAudioSession().catch(() => {});

    return () => {
      socket.disconnect();
      AudioSession.stopAudioSession().catch(() => {});
    };
  }, [name]);

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
  const boardStage = stage === 'group' || stage === 'pairs' || stage === 'fours';
  const boardReadOnly = stage === 'group';

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={[styles.dot, { color: connected ? '#27ae60' : '#e74c3c' }]}>●</Text>
        <Text style={styles.stageLabel}>{STAGE_LABELS[stage]}</Text>
        {secondsLeft !== null && (
          <Text style={styles.timer}>{secondsLeft}с</Text>
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
          serverUrl={livekit.url}
          token={livekit.token}
          connect={true}
          audio={true}
          video={false}
        />
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
