import React from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { render, screen, act, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import App from '../../../App';
import { syncOnResume } from '../../domain/sync/engine';
import { SYNC_COPY } from '../../domain/sync/backupStatus';

// The throttle and "signed in?" checks live in syncOnResume (resume.test.ts);
// here it is a stand-in so the screen's side can be checked.
jest.mock('../../domain/sync/engine', () => ({
  ...jest.requireActual('../../domain/sync/engine'),
  syncOnResume: jest.fn(async () => 'synced'),
}));
const mockSyncOnResume = syncOnResume as jest.Mock;

let listeners: Array<(s: AppStateStatus) => void> = [];

beforeEach(async () => {
  await AsyncStorage.clear();
  mockSyncOnResume.mockClear();
  listeners = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, fn) => {
    listeners.push(fn as (s: AppStateStatus) => void);
    return { remove: () => { listeners = listeners.filter((l) => l !== fn); } } as never;
  });
});

async function goAndComeBack() {
  await act(async () => {
    listeners.forEach((l) => l('background'));
    listeners.forEach((l) => l('active'));
  });
}

it('syncs when the app comes back from the background', async () => {
  render(<App />);
  await screen.findByTestId('empty-add-button');
  expect(mockSyncOnResume).not.toHaveBeenCalled();
  await goAndComeBack();
  expect(mockSyncOnResume).toHaveBeenCalledTimes(1);
});

it('does not sync when the app only becomes active again without leaving', async () => {
  render(<App />);
  await screen.findByTestId('empty-add-button');
  await act(async () => listeners.forEach((l) => l('active')));
  expect(mockSyncOnResume).not.toHaveBeenCalled();
});

it('stays quiet when the sync works or the phone is offline', async () => {
  render(<App />);
  await screen.findByTestId('empty-add-button');
  await goAndComeBack();
  mockSyncOnResume.mockResolvedValueOnce('offline');
  await goAndComeBack();
  expect(screen.queryByText(SYNC_COPY.error)).toBeNull();
  expect(screen.queryByText(SYNC_COPY.offline)).toBeNull();
});

it('says calmly when it fails, once per session', async () => {
  render(<App />);
  await screen.findByTestId('empty-add-button');
  mockSyncOnResume.mockResolvedValueOnce('error');
  await goAndComeBack();
  expect(await screen.findByText(SYNC_COPY.error)).toBeTruthy();

  await waitFor(() => expect(screen.queryByText(SYNC_COPY.error)).toBeNull(), { timeout: 8000 });
  mockSyncOnResume.mockResolvedValueOnce('error');
  await goAndComeBack();
  expect(screen.queryByText(SYNC_COPY.error)).toBeNull();
}, 15000);
