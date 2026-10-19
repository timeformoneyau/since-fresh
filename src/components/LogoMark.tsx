import React from 'react';
import { View, StyleSheet } from 'react-native';
import { palette } from '../theme/tokens';

interface Props {
  size?: number;
}

/**
 * The Since mark: a ring drawn as three quarters of a circle, from 12
 * o'clock clockwise round to 9, with a dot at the end marking "now"
 * (assets/since-mark.svg). Built from plain views, for use on navy.
 */
export default function LogoMark({ size = 38 }: Props) {
  // Proportions from since-mark.svg: ring radius 22 and stroke 7, dot radius 9
  const scale = size / 66;
  const stroke = 7 * scale;
  const ring = (44 + 7) * scale;
  const dot = 18 * scale;

  return (
    <View
      style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {/* The top border is the gap; turning it back 45° puts the gap between 9 and 12 */}
      <View
        style={[
          styles.ring,
          {
            width: ring,
            height: ring,
            borderRadius: ring / 2,
            borderWidth: stroke,
            transform: [{ rotate: '-45deg' }],
          },
        ]}
      />
      <View
        style={[
          styles.dot,
          {
            width: dot,
            height: dot,
            borderRadius: dot / 2,
            left: size / 2 - (ring - stroke) / 2 - dot / 2,
            top: size / 2 - dot / 2,
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  ring: {
    borderColor: palette.ringPale,
    borderTopColor: 'transparent',
  },
  dot: {
    position: 'absolute',
    backgroundColor: palette.ice,
  },
});
