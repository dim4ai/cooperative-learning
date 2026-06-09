import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

interface Props {
  question: string;
  options: string[];
  myVote: number | null;
  onVote: (index: number) => void;
}

export function PollBar({ question, options, myVote, onVote }: Props) {
  return (
    <View style={styles.container}>
      <Text style={styles.question}>{question}</Text>
      <View style={styles.options}>
        {options.map((opt, i) => (
          <TouchableOpacity
            key={i}
            onPress={() => onVote(i)}
            style={[styles.option, myVote === i && styles.optionSelected]}
          >
            <Text style={[styles.optionText, myVote === i && styles.optionTextSelected]}>
              {opt}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#fffbe6',
    borderBottomWidth: 1,
    borderBottomColor: '#ffe58f',
    padding: 12,
    gap: 8,
  },
  question: {
    fontSize: 15,
    fontWeight: '600',
    color: '#333',
  },
  options: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  option: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#ccc',
    backgroundColor: '#fff',
  },
  optionSelected: {
    backgroundColor: '#4a90e2',
    borderColor: '#4a90e2',
  },
  optionText: {
    fontSize: 14,
    color: '#333',
  },
  optionTextSelected: {
    color: '#fff',
  },
});
