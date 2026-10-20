import { StyleSheet } from 'react-native';
import { colours, fonts } from '../../theme/tokens';

/** Shared styling for the sign-in and code screens (shown under a header). */
export const authStyles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colours.background },
  container: {
    flexGrow: 1,
    paddingHorizontal: 28,
    paddingTop: 24,
    paddingBottom: 40,
  },
  heading: {
    fontSize: 26,
    fontFamily: fonts.bold,
    color: colours.textPrimary,
    letterSpacing: -0.3,
    marginBottom: 6,
  },
  subheading: {
    fontFamily: fonts.regular, fontSize: 15,
    color: colours.textSecondary,
    marginBottom: 36,
    lineHeight: 21,
  },
  form: { gap: 16 },
  field: { gap: 6 },
  label: {
    fontSize: 11,
    fontFamily: fonts.semibold,
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
    fontFamily: fonts.regular, fontSize: 15,
    color: colours.textPrimary,
  },
  codeInput: {
    fontFamily: fonts.regular, fontSize: 22,
    letterSpacing: 6,
    textAlign: 'center',
  },
  errorText: {
    fontFamily: fonts.regular, fontSize: 13,
    color: colours.destructive,
    marginTop: -4,
  },
  noticeText: {
    fontFamily: fonts.regular, fontSize: 13,
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
    fontFamily: fonts.semibold,
  },
  linkBtn: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  linkText: {
    fontFamily: fonts.regular, fontSize: 14,
    color: colours.textSecondary,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 'auto',
    paddingTop: 32,
  },
  footerText: {
    fontFamily: fonts.regular, fontSize: 14,
    color: colours.textSecondary,
  },
  footerLink: {
    fontSize: 14,
    color: colours.textPrimary,
    fontFamily: fonts.semibold,
  },
});
