// Mock authentication service that doesn't require Firebase
export interface User {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
}

export interface UserProfile {
  uid: string;
  name: string | null;
  email: string | null;
  picture: string | null;
}

let currentUser: User | null = null;
const authListeners: ((user: User | null) => void)[] = [];

export const mockAuth = {
  // Mock sign in
  signInWithEmailAndPassword: async (email: string, password: string) => {
    console.log('Mock sign in with:', email);
    const user: User = {
      uid: 'mock-user-123',
      email,
      displayName: email.split('@')[0],
      photoURL: null
    };
    currentUser = user;
    authListeners.forEach(listener => listener(user));
    return { user };
  },

  // Mock sign up
  createUserWithEmailAndPassword: async (email: string, password: string) => {
    console.log('Mock sign up with:', email);
    const user: User = {
      uid: 'mock-user-123',
      email,
      displayName: email.split('@')[0],
      photoURL: null
    };
    currentUser = user;
    authListeners.forEach(listener => listener(user));
    return { user };
  },

  // Mock sign out
  signOut: async () => {
    console.log('Mock sign out');
    currentUser = null;
    authListeners.forEach(listener => listener(null));
  },

  // Mock auth state listener
  onAuthStateChanged: (callback: (user: User | null) => void) => {
    authListeners.push(callback);
    // Immediately call with current user
    callback(currentUser);
    
    // Return unsubscribe function
    return () => {
      const index = authListeners.indexOf(callback);
      if (index > -1) {
        authListeners.splice(index, 1);
      }
    };
  },

  // Get current user
  getCurrentUser: () => currentUser
};
