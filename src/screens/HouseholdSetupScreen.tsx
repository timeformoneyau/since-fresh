import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, KeyboardAvoidingView, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useHeaderHeight } from '@react-navigation/elements';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { createHousehold, joinHousehold, householdErrorMessage } from '../domain/household/service';
import { HOUSEHOLD_RULES, agreeToRulesText } from '../domain/household/report';
import { syncNow } from '../domain/sync/engine';
import { colours } from '../theme/tokens';
import { authStyles as s } from './auth/authStyles';

type Nav = NativeStackNavigationProp<RootStackParamList, 'HouseholdSetup'>;
type Route = RouteProp<RootStackParamList, 'HouseholdSetup'>;

/** Create a household, or join one with a code (sync plan, PR 6). */
export default function HouseholdSetupScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const { mode } = useRoute<Route>().params;
  const joining = mode === 'join';
  const [first, setFirst] = useState(''); // household name, or the code
  const [myName, setMyName] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSubmit() {
    if (!first.trim()) {
      setError(joining ? 'Enter the code you were given.' : 'Give the household a name.');
      return;
    }
    if (!myName.trim()) {
      setError('Add the name others will see.');
      return;
    }
    setError('');
    setSaving(true);
    try {
      if (joining) await joinHousehold(first, myName);
      else await createHousehold(first, myName);
      // Picks up the household and, when joining, its shared items
      await syncNow();
      navigation.popTo('Account');
    } catch (e) {
      setError(householdErrorMessage(e));
      setSaving(false);
    }
  }

  return (
    <KeyboardAvoidingView style={s.flex} behavior="padding" keyboardVerticalOffset={headerHeight}>
      <ScrollView
        contentContainerStyle={[s.container, { paddingBottom: 40 + insets.bottom }]}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={s.heading}>{joining ? 'Join a household' : 'Create a household'}</Text>
        <Text style={s.subheading}>
          {joining
            ? 'Enter the code someone in the household gave you. Your own items stay just yours.'
            : 'Share items with the people you live with. Each item stays just yours unless you choose Household.'}
        </Text>

        <View style={s.form}>
          <View style={s.field}>
            <Text style={s.label}>{joining ? 'Code' : 'Household name'}</Text>
            <TextInput
              style={[s.input, joining && s.codeInput]}
              testID="household-first-input"
              value={first}
              onChangeText={(t) => { setFirst(joining ? t.toUpperCase() : t); setError(''); }}
              placeholder={joining ? 'ABCD-EFGH' : 'e.g. Home'}
              placeholderTextColor={colours.textMuted}
              autoCapitalize={joining ? 'characters' : 'words'}
              autoCorrect={false}
              maxLength={joining ? 9 : 60}
              accessibilityLabel={joining ? 'Code' : 'Household name'}
            />
          </View>
          <View style={s.field}>
            <Text style={s.label}>Your name</Text>
            <TextInput
              style={s.input}
              testID="household-name-input"
              value={myName}
              onChangeText={(t) => { setMyName(t); setError(''); }}
              placeholder="As others will see it"
              placeholderTextColor={colours.textMuted}
              autoCapitalize="words"
              maxLength={40}
              returnKeyType="done"
              onSubmitEditing={handleSubmit}
              accessibilityLabel="Your name"
            />
          </View>

          {error !== '' && <Text style={s.errorText}>{error}</Text>}

          <Text style={s.subheading} testID="household-rules">
            {HOUSEHOLD_RULES} {agreeToRulesText(joining)}
          </Text>

          <TouchableOpacity
            style={[s.primaryBtn, saving && s.btnDisabled]}
            testID="household-submit-button"
            onPress={handleSubmit}
            disabled={saving}
            accessibilityRole="button"
          >
            <Text style={s.primaryBtnText}>
              {saving ? 'One moment…' : joining ? 'Join' : 'Create household'}
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
