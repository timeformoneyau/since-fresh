import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Keyboard, KeyboardEvent, Platform, StyleProp, View, ViewStyle } from 'react-native';
import { keyboardOverlap } from '../utils/keyboard';

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
  // The keyboard's top edge on screen; null while it's closed
  const keyboardTop = useRef<number | null>(null);
  const [overlap, setOverlap] = useState(0);

  const measure = useCallback(() => {
    if (keyboardTop.current === null) {
      setOverlap(0);
      return;
    }
    // measure, not measureInWindow: on Android, measureInWindow counts from
    // below the status bar, while the keyboard's edge counts from the top of
    // the screen. measure's page position counts from the top of the app,
    // which draws edge to edge, so from the top of the screen too.
    ref.current?.measure((_x, _y, _w, height, _pageX, pageY) => {
      // The keyboard may have closed while measuring
      if (keyboardTop.current !== null) setOverlap(keyboardOverlap(pageY + height, keyboardTop.current));
    });
  }, []);

  const opened = useCallback((screenY: number) => {
    keyboardTop.current = screenY;
    measure();
  }, [measure]);

  useEffect(() => {
    // Opened with the keyboard already up
    const metrics = Keyboard.isVisible() ? Keyboard.metrics() : undefined;
    if (metrics) opened(metrics.screenY);
    const ios = Platform.OS === 'ios';
    const shown = Keyboard.addListener(ios ? 'keyboardWillShow' : 'keyboardDidShow', (e: KeyboardEvent) =>
      opened(e.endCoordinates.screenY),
    );
    const hidden = Keyboard.addListener(ios ? 'keyboardWillHide' : 'keyboardDidHide', () => {
      keyboardTop.current = null;
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
