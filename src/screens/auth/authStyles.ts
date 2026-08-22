import { StyleSheet } from 'react-native';
import { colours } from '../../components/colours';

/** Shared styling for the auth stack. Ported from the `since` codebase. */
export const authStyles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colours.background },
  container: {
    flexGrow: 1,
    paddingHorizontal: 28,
    paddingTop: 80,
    paddingBottom: 40,
  },
  appName: {
    fontSize: 32,
    fontWeight: '700',
    color: colours.textPrimary,
    letterSpacing: -0.5,
    marginBottom: 32,
  },
  heading: {
    fontSize: 26,
    fontWeight: '700',
    color: colours.textPrimary,
    letterSpacing: -0.3,
    marginBottom: 6,
  },
  subheading: {
    fontSize: 15,
    color: colours.textSecondary,
    marginBottom: 36,
    lineHeight: 21,
  },
  form: { gap: 16 },
  field: { gap: 6 },
  label: {
    fontSize: 11,
    fontWeight: '600',
    color: colours.textMuted,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  input: {
    backgroundColor: colours.surface,
    borderWidth: 1,
    borderColor: colours.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 15,
    color: colours.textPrimary,
  },
  errorText: {
    fontSize: 13,
    color: colours.destructive,
    marginTop: -4,
  },
  noticeText: {
    fontSize: 13,
    color: colours.textSecondary,
    lineHeight: 19,
    marginTop: -4,
  },
  primaryBtn: {
    backgroundColor: colours.textPrimary,
    paddingVertical: 15,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 4,
  },
  btnDisabled: { opacity: 0.5 },
  primaryBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  linkBtn: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  linkText: {
    fontSize: 14,
    color: colours.textSecondary,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 'auto',
    paddingTop: 32,
  },
  footerText: {
    fontSize: 14,
    color: colours.textSecondary,
  },
  footerLink: {
    fontSize: 14,
    color: colours.textPrimary,
    fontWeight: '600',
  },
});
