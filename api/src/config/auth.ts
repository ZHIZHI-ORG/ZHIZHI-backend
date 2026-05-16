const TRUE_VALUES = new Set(['true', '1', 'yes', 'on']);

export function isInviteCodeRequired(): boolean {
  return TRUE_VALUES.has((process.env.INVITE_CODE_REQUIRED ?? '').trim().toLowerCase());
}
