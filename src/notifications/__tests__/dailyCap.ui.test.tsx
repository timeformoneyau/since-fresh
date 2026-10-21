import AsyncStorage from '@react-native-async-storage/async-storage';
import { format, subMonths, addDays } from 'date-fns';
import { createItem, markItemDone } from '../../domain/items/service';
import { useScheduledStore, perDay, scheduled } from './scheduled';

beforeEach(async () => {
  await AsyncStorage.clear();
  useScheduledStore();
});

// Three monthly items last done on the same day are all due on the same day
const lastDone = format(addDays(subMonths(new Date(), 1), 10), 'yyyy-MM-dd');

async function addThree() {
  for (const name of ['Bins', 'Plants', 'Filter']) {
    await createItem({ name, category: 'Household', lastDoneDate: lastDone, repeatValue: 1, repeatUnit: 'months' });
  }
}

it('keeps to 2 reminders a day when items are added one by one', async () => {
  await addThree();
  for (const count of perDay().values()) expect(count).toBeLessThanOrEqual(2);
});

it('keeps to 2 a day after marking one done and others share its new days', async () => {
  await addThree();
  const extra = await createItem({ name: 'Car', category: 'Auto', lastDoneDate: lastDone, repeatValue: 1, repeatUnit: 'months' });
  await markItemDone(extra.id);
  for (const count of perDay().values()) expect(count).toBeLessThanOrEqual(2);
  expect(scheduled().length).toBeGreaterThan(0);
});
