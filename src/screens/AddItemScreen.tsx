import React from 'react';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { createItem } from '../domain/items/service';
import { todayString } from '../utils/dateUtils';
import ItemForm from '../components/ItemForm';

type Nav = NativeStackNavigationProp<RootStackParamList, 'Add'>;

export default function AddItemScreen() {
  const navigation = useNavigation<Nav>();

  return (
    <ItemForm
      prefix="add"
      title="Track something"
      initial={{ name: '', category: 'Other', lastDoneDate: todayString(), repeatValue: 30, repeatUnit: 'days' }}
      submitLabel="Track this"
      dateHelp="This becomes the first entry in its history. You can add or edit past entries later."
      suggestFromName
      autoFocusName
      onSubmit={async (values) => {
        await createItem(values);
        navigation.goBack();
      }}
    />
  );
}
