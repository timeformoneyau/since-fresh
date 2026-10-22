/** The list view (rules.ts), on this phone only. */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { parseListView, serializeListView, DEFAULT_LIST_VIEW, type ListView } from './rules';

export const LIST_VIEW_KEY = '@since_list_view_v1';

export async function loadListView(): Promise<ListView> {
  try {
    return parseListView(await AsyncStorage.getItem(LIST_VIEW_KEY));
  } catch {
    return DEFAULT_LIST_VIEW;
  }
}

export async function saveListView(view: ListView): Promise<void> {
  await AsyncStorage.setItem(LIST_VIEW_KEY, serializeListView(view));
}
