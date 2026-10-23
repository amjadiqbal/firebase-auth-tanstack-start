import {createSerializationAdapter} from '@tanstack/react-router';

import {FirebaseAuthError, type FirebaseAuthErrorCode} from './errors';

/**
 * Lets a `FirebaseAuthError` thrown on the server (for example by `requireUser()` in a server function) reach the
 * browser as a `FirebaseAuthError` with its `code` and `status`, instead of a plain `Error` with only the message.
 * Register it in `src/start.ts`: `createStart(() => ({ serializationAdapters: [firebaseAuthErrorAdapter] }))`.
 */
export const firebaseAuthErrorAdapter = createSerializationAdapter({
  key: 'amjadiqbal/firebase-auth-error',
  test: (value): value is FirebaseAuthError => value instanceof FirebaseAuthError,
  toSerializable: (error) => ({code: error.code as string, message: error.message}),
  fromSerializable: ({code, message}) => new FirebaseAuthError(code as FirebaseAuthErrorCode, message),
});
