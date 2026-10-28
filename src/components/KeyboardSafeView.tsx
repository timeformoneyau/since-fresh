import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Dimensions, Keyboard, KeyboardEvent, KeyboardMetrics, Platform, StyleProp, View, ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { keyboardOverlap, OpenKeyboard } from '../utils/keyboard';

interface Props {
  style?: StyleProp<ViewStyle>;
  /** Space kept at the bottom while the keyboard is closed (e.g. the nav bar inset). */
  minPaddingBottom?: number;
  children: React.ReactNode;
}

/**
 * A full-height screen that keeps its content above the keyboard.
 *
 * Replaces KeyboardAvoidingView, which on Android treats "keyboard hidden" as
 * one more keyboard position and, under edge-to-edge, leaves space at the
 * bottom after the keyboard closes. Here a hidden keyboard always means no
 * space, and an open one covers only as far as it really overlaps this view
 * on screen.
 */
export default function KeyboardSafeView({ style, minPaddingBottom = 0, children }: Props) {
  const ref = useRef<View>(null);
  const insets = useSafeAreaInsets();
  // The open keyboard; null while it's closed
  const keyboard = useRef<OpenKeyboard | null>(null);
  const [overlap, setOverlap] = useState(0);

  const measure = useCallback(() => {
    if (keyboard.current === null) {
      setOverlap(0);
      return;
    }
    ref.current?.measureInWindow((_x, y, _w, height) => {
      // The keyboard may have closed while measuring
      if (keyboard.current !== null) setOverlap(keyboardOverlap(y + height, keyboard.current));
    });
  }, []);

  // The bottom inset is read when the keyboard opens, so keep the latest
  const bottomInset = useRef(insets.bottom);
  bottomInset.current = insets.bottom;
  const opened = useCallback((k: KeyboardMetrics) => {
    keyboard.current = {
      top: k.screenY,
      height: k.height,
      screenBottom: Dimensions.get('screen').height,
      // On Android the keyboard's reported height stops at the nav bar
      belowKeyboard: Platform.OS === 'android' ? bottomInset.current : 0,
    };
    measure();
  }, [measure]);

  useEffect(() => {
    // Opened with the keyboard already up
    const metrics = Keyboard.isVisible() ? Keyboard.metrics() : undefined;
    if (metrics) opened(metrics);
    const ios = Platform.OS === 'ios';
    const shown = Keyboard.addListener(ios ? 'keyboardWillShow' : 'keyboardDidShow', (e: KeyboardEvent) =>
      opened(e.endCoordinates),
    );
    const hidden = Keyboard.addListener(ios ? 'keyboardWillHide' : 'keyboardDidHide', () => {
      keyboard.current = null;
      setOverlap(0);
    });
    return () => { shown.remove(); hidden.remove(); };
  }, [opened]);

  return (
    <View
      ref={ref}
      onLayout={measure}
      style={[{ flex: 1 }, style, { paddingBottom: Math.max(overlap, minPaddingBottom) }]}
    >
      {children}
    </View>
  );
}
