// Mock Firebase configuration that doesn't require API keys
import { mockAuth } from './services/mockAuthService';

// Mock Firebase exports
export const auth = mockAuth;
export const onAuthStateChanged = mockAuth.onAuthStateChanged;
export const db = {
  collection: () => ({
    doc: () => ({
      get: () => Promise.resolve({ exists: true, data: () => ({}) }),
      set: () => Promise.resolve(),
      update: () => Promise.resolve(),
      delete: () => Promise.resolve()
    }),
    add: () => Promise.resolve({ id: 'mock-doc-id' }),
    where: () => ({
      get: () => Promise.resolve({ docs: [] })
    })
  })
};

console.log('Using mock Firebase services - no API keys required!');
