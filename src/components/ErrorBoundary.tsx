import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import * as Updates from 'expo-updates';
import { colours, fonts } from '../theme/tokens';

export const RECOVERY_COPY = {
  heading: 'Something went wrong',
  body: 'Since stopped unexpectedly. Your list is saved on this phone. Restarting usually sorts it out.',
  restart: 'Restart Since',
} as const;

/** Restart the app's JavaScript. Where that isn't possible (Expo Go, tests), show the app again. */
async function restart(fallback: () => void): Promise<void> {
  try {
    await Updates.reloadAsync();
  } catch {
    fallback();
  }
}

type State = { failed: boolean };

/**
 * Around the whole app: a fatal JavaScript error during rendering shows a
 * calm recovery screen instead of closing the app. Local only: nothing is
 * logged or sent anywhere. Saved data is untouched (it lives in storage, not
 * in what crashed).
 */
export default class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(): void {
    // Deliberately nothing: no crash reporting
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <View style={styles.screen} testID="error-recovery">
        <Text style={styles.heading} accessibilityRole="header">{RECOVERY_COPY.heading}</Text>
        <Text style={styles.body}>{RECOVERY_COPY.body}</Text>
        <TouchableOpacity
          style={styles.button}
          testID="error-restart-button"
          onPress={() => restart(() => this.setState({ failed: false }))}
          accessibilityRole="button"
        >
          <Text style={styles.buttonText}>{RECOVERY_COPY.restart}</Text>
        </TouchableOpacity>
      </View>
    );
  }
}

// System font sizes only: fonts may be what failed to load
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colours.background, justifyContent: 'center', padding: 28 },
  heading: { fontSize: 24, fontFamily: fonts.bold, color: colours.textPrimary, marginBottom: 8 },
  body: { fontSize: 15, fontFamily: fonts.regular, color: colours.textSecondary, lineHeight: 21, marginBottom: 28 },
  button: { backgroundColor: colours.textPrimary, paddingVertical: 15, borderRadius: 12, alignItems: 'center' },
  buttonText: { color: '#fff', fontSize: 15, fontFamily: fonts.semibold },
});
