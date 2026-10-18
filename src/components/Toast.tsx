import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colours } from './colours';

const SHOW_MS = 5000;

interface ToastOptions {
  message: string;
  actionLabel?: string;
  onAction?: () => void | Promise<void>;
}

type ShowToast = (options: ToastOptions) => void;

const ToastContext = createContext<ShowToast>(() => {});

/** Show a short message at the bottom of the screen, optionally with one action (e.g. Undo). */
export function useToast(): ShowToast {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  const [toast, setToast] = useState<(ToastOptions & { key: number }) | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hide = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setToast(null);
  }, []);

  const show = useCallback<ShowToast>((options) => {
    if (timer.current) clearTimeout(timer.current);
    setToast({ ...options, key: Date.now() });
    timer.current = setTimeout(() => setToast(null), SHOW_MS);
  }, []);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  async function handleAction() {
    const action = toast?.onAction;
    hide();
    await action?.();
  }

  return (
    <ToastContext.Provider value={show}>
      <View style={styles.flex}>
        {children}
        {toast && (
          <View
            key={toast.key}
            style={[styles.toast, { bottom: 16 + insets.bottom }]}
            testID="toast"
            accessibilityLiveRegion="polite"
          >
            <Text style={styles.message} numberOfLines={2}>{toast.message}</Text>
            {toast.actionLabel && toast.onAction && (
              <TouchableOpacity
                onPress={handleAction}
                testID="toast-action"
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                accessibilityRole="button"
              >
                <Text style={styles.action}>{toast.actionLabel}</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </View>
    </ToastContext.Provider>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  toast: {
    position: 'absolute',
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colours.textPrimary,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
  },
  message: { color: '#fff', fontSize: 14, flex: 1, marginRight: 12 },
  action: { color: '#fff', fontSize: 14, fontWeight: '600' },
});
