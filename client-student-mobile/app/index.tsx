import { useEffect, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';

const NAME_KEY = 'student_name';
const CODE_KEY = 'lesson_code';

export default function LoginScreen() {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');

  useEffect(() => {
    AsyncStorage.getItem(NAME_KEY).then(saved => {
      if (saved) setName(saved);
    });
    AsyncStorage.getItem(CODE_KEY).then(saved => {
      if (saved) setCode(saved);
    });
  }, []);

  async function connect() {
    const trimmedName = name.trim();
    const trimmedCode = code.trim().toLowerCase();
    if (!trimmedName || !trimmedCode) return;
    await AsyncStorage.setItem(NAME_KEY, trimmedName);
    await AsyncStorage.setItem(CODE_KEY, trimmedCode);
    router.replace({ pathname: '/lesson', params: { name: trimmedName, code: trimmedCode } });
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <Text style={styles.title}>Кооперативное обучение</Text>
        <Text style={styles.subtitle}>Введите ваше имя</Text>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          placeholder="Имя ученика"
          placeholderTextColor="#aaa"
          autoCapitalize="words"
          returnKeyType="next"
        />
        <TextInput
          style={styles.input}
          value={code}
          onChangeText={setCode}
          placeholder="Код занятия"
          placeholderTextColor="#aaa"
          autoCapitalize="none"
          returnKeyType="go"
          onSubmitEditing={connect}
        />
        <TouchableOpacity
          style={[styles.button, (!name.trim() || !code.trim()) && styles.buttonDisabled]}
          onPress={connect}
          disabled={!name.trim() || !code.trim()}
        >
          <Text style={styles.buttonText}>Войти на урок</Text>
        </TouchableOpacity>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#fff',
  },
  container: {
    flex: 1,
    justifyContent: 'center',
    padding: 32,
    gap: 16,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#1a1a2e',
    textAlign: 'center',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 15,
    color: '#666',
    textAlign: 'center',
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 10,
    padding: 14,
    fontSize: 17,
    color: '#111',
    backgroundColor: '#fafafa',
  },
  button: {
    backgroundColor: '#4a90e2',
    borderRadius: 10,
    padding: 16,
    alignItems: 'center',
  },
  buttonDisabled: {
    backgroundColor: '#b0c8ef',
  },
  buttonText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '600',
  },
});
