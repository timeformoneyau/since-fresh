import React from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  Pressable,
} from 'react-native';
import { DEFAULT_CATEGORIES } from '../types';
import { colours, fonts } from '../theme/tokens';

interface Props {
  value: string;
  onSelect: (category: string) => void;
  onCancel: () => void;
}

export default function CategoryPicker({ value, onSelect, onCancel }: Props) {
  return (
    <Modal transparent animationType="slide" onRequestClose={onCancel}>
      <Pressable style={styles.backdrop} onPress={onCancel} />
      <View style={styles.sheet}>
        <View style={styles.toolbar}>
          <TouchableOpacity onPress={onCancel}>
            <Text style={styles.toolbarCancel}>Cancel</Text>
          </TouchableOpacity>
          <Text style={styles.toolbarTitle}>Category</Text>
          <View style={{ width: 52 }} />
        </View>
        <FlatList
          data={[...DEFAULT_CATEGORIES]}
          keyExtractor={(item) => item}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.row}
              onPress={() => onSelect(item)}
            >
              <Text
                style={[
                  styles.rowText,
                  item === value && styles.rowTextSelected,
                ]}
              >
                {item}
              </Text>
              {item === value && <Text style={styles.checkmark}>✓</Text>}
            </TouchableOpacity>
          )}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  sheet: {
    backgroundColor: colours.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: '60%',
    paddingBottom: 32,
  },
  toolbar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colours.border,
  },
  toolbarCancel: { fontFamily: fonts.regular, fontSize: 15, color: colours.textSecondary },
  toolbarTitle: { fontSize: 15, fontFamily: fonts.semibold, color: colours.textPrimary },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 20,
  },
  rowText: { fontFamily: fonts.regular, fontSize: 15, color: colours.textPrimary },
  rowTextSelected: { fontFamily: fonts.semibold },
  checkmark: { fontFamily: fonts.regular, fontSize: 16, color: colours.textPrimary },
  separator: { height: 1, backgroundColor: colours.border, marginHorizontal: 20 },
});
