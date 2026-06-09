import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { io } from 'socket.io-client';

export interface Seat {
  id: string;
  groupIndex: number;
  row: number;
  col: number;
  occupant: string | null;
}

const PALETTE = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c', '#e67e22', '#e91e63'];
const groupColor = (g: number) => PALETTE[g % PALETTE.length];

interface Props {
  seats: Seat[];
  myName: string;
  socket: ReturnType<typeof io>;
}

export function WaitingView({ seats, myName, socket }: Props) {
  if (seats.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>Учитель ещё не настроил рассадку</Text>
      </View>
    );
  }

  const numGroups = Math.max(...seats.map(s => s.groupIndex)) + 1;
  const mySeat = seats.find(s => s.occupant === myName);

  function claim(seatId: string) {
    socket.emit('claimSeat', seatId);
  }

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <Text style={styles.hint}>
        {mySeat
          ? `Группа ${mySeat.groupIndex + 1}, место ${mySeat.row * 2 + mySeat.col + 1}`
          : 'Выберите место'}
      </Text>
      <View style={styles.groups}>
        {Array.from({ length: numGroups }, (_, g) => {
          const groupSeats = seats.filter(s => s.groupIndex === g);
          const color = groupColor(g);
          return (
            <View key={g} style={[styles.group, { borderColor: color }]}>
              <Text style={[styles.groupLabel, { color }]}>Группа {g + 1}</Text>
              {[0, 1].map(row => (
                <View key={row} style={[styles.pairRow, { borderColor: color + '55' }]}>
                  {[0, 1].map(col => {
                    const seat = groupSeats.find(s => s.row === row && s.col === col);
                    if (!seat) return null;
                    const isMe = seat.occupant === myName;
                    const isFree = !seat.occupant;
                    return (
                      <TouchableOpacity
                        key={seat.id}
                        onPress={() => isFree && claim(seat.id)}
                        disabled={!!seat.occupant && !isMe}
                        style={[
                          styles.seat,
                          { borderColor: isMe ? color : isFree ? '#ddd' : color + '88' },
                          isMe && { backgroundColor: color + '33' },
                          !isFree && !isMe && { backgroundColor: color + '22' },
                        ]}
                      >
                        <Text style={[styles.seatName, isMe && { color, fontWeight: '700' }]}>
                          {seat.occupant ? (isMe ? 'Вы' : seat.occupant) : String(row * 2 + col + 1)}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              ))}
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    color: '#aaa',
    fontSize: 16,
  },
  scroll: {
    padding: 16,
    gap: 16,
  },
  hint: {
    fontSize: 14,
    color: '#555',
    marginBottom: 8,
  },
  groups: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  group: {
    borderWidth: 2,
    borderRadius: 10,
    padding: 8,
    gap: 6,
  },
  groupLabel: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 2,
  },
  pairRow: {
    flexDirection: 'row',
    gap: 6,
    borderWidth: 1,
    borderRadius: 6,
    padding: 4,
  },
  seat: {
    width: 80,
    height: 56,
    borderWidth: 1.5,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  seatName: {
    fontSize: 13,
    color: '#888',
  },
});
