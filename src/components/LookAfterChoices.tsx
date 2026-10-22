import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { LOOK_AFTER_COPY, type LookAfterChoice } from '../domain/household/rules';
import { palette, fonts, radius, TAP } from '../theme/tokens';

/**
 * "Who looks after this?" on a shared item: Anyone, You, then each other
 * member (household/rules.ts lookAfterChoices). Chips as on the Add/Edit
 * form. Used by that form and the item screen.
 */
export default function LookAfterChoices(props: {
  /** testID prefix: 'add', 'edit' or 'detail'. */
  prefix: string;
  choices: LookAfterChoice[];
  value: string | null;
  me: string | null;
  onChange: (userId: string | null) => void;
  disabled?: boolean;
}) {
  return (
    <View style={styles.wrap} accessibilityRole="radiogroup" accessibilityLabel={LOOK_AFTER_COPY.question}>
      {props.choices.map((c) => {
        const selected = props.value === c.userId;
        const id = c.userId === null ? 'anyone' : c.userId === props.me ? 'you' : c.userId;
        return (
          <TouchableOpacity
            key={id}
            style={[styles.chip, selected && styles.selectedFill]}
            onPress={() => props.onChange(c.userId)}
            disabled={props.disabled}
            testID={`${props.prefix}-look-after-${id}`}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected, disabled: props.disabled }}
            accessibilityLabel={id === 'you' ? LOOK_AFTER_COPY.takeIt : c.label}
          >
            <Text style={[styles.chipText, selected && styles.selectedText]}>{c.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

// The same chips as ItemForm's date and category choices
const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    minHeight: TAP,
    paddingHorizontal: 16,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: palette.border,
    backgroundColor: palette.card,
    justifyContent: 'center',
  },
  chipText: { fontFamily: fonts.semibold, fontSize: 14.5, color: palette.ink },
  selectedFill: { backgroundColor: palette.navy, borderColor: palette.navy },
  selectedText: { color: '#FFFFFF' },
});
