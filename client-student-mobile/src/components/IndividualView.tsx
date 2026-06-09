import { View, Text, StyleSheet } from 'react-native';
import { CallButton } from './CallButton';

interface Props {
  calling: boolean;
  onToggleCall: () => void;
}

export function IndividualView({ calling, onToggleCall }: Props) {
  return (
    <View style={styles.container}>
      <Text style={styles.label}>Индивидуальная работа</Text>
      <Text style={styles.hint}>
        {calling ? 'Ждём учителя...' : 'Нужна помощь? Позовите учителя'}
      </Text>
      <CallButton calling={calling} onToggle={onToggleCall} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    backgroundColor: '#f8f8f8',
  },
  label: {
    fontSize: 20,
    fontWeight: '600',
    color: '#1a1a2e',
  },
  hint: {
    fontSize: 14,
    color: '#888',
  },
});
