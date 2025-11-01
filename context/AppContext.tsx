import React, { createContext, useContext, useReducer, useEffect, ReactNode } from 'react';
// Fix: Remove direct Firebase imports and use the centralized module
import firebase, { auth } from '../firebase';
import { Email, Folder, UserProfile } from '../types';
import { getEmails } from '../services/emailService';

interface AppState {
  isAuthenticated: boolean;
  userProfile: UserProfile | null;
  emails: Email[];
  currentFolder: Folder;
  selectedEmail: Email | null;
  isComposeOpen: boolean;
  composeEmail: Partial<Email>;
  loading: boolean;
  error: string | null;
  isChatbotOpen: boolean;
  currentLanguage: string;
}

type Action =
  | { type: 'LOGIN_SUCCESS'; payload: UserProfile }
  | { type: 'LOGOUT_SUCCESS' }
  | { type: 'FETCH_EMAILS_START' }
  | { type: 'FETCH_EMAILS_SUCCESS'; payload: Email[] }
  | { type: 'FETCH_EMAILS_FAILURE'; payload: string }
  | { type: 'SELECT_FOLDER'; payload: Folder }
  | { type: 'SELECT_EMAIL'; payload: string | null }
  | { type: 'MARK_AS_READ'; payload: string }
  | { type: 'DELETE_EMAIL'; payload: string }
  | { type: 'DELETE_EMAIL_FOREVER'; payload: string }
  | { type: 'MOVE_TO_SPAM'; payload: string }
  | { type: 'START_COMPOSE'; payload?: Partial<Email> }
  | { type: 'UPDATE_COMPOSE'; payload: Partial<Email> }
  | { type: 'SEND_COMPOSE' }
  | { type: 'CLOSE_COMPOSE' }
  | { type: 'TOGGLE_CHATBOT' }
  | { type: 'SET_LANGUAGE'; payload: string };

const initialState: AppState = {
  isAuthenticated: false,
  userProfile: null,
  emails: [],
  currentFolder: Folder.INBOX,
  selectedEmail: null,
  isComposeOpen: false,
  composeEmail: {},
  loading: true, // Start loading to check auth status
  error: null,
  isChatbotOpen: false,
  currentLanguage: 'en-US',
};

const appReducer = (state: AppState, action: Action): AppState => {
  switch (action.type) {
    case 'LOGIN_SUCCESS':
      return { ...state, isAuthenticated: true, userProfile: action.payload, loading: false, error: null };
    case 'LOGOUT_SUCCESS':
      return { ...initialState, isAuthenticated: false, userProfile: null, loading: false };
    case 'FETCH_EMAILS_START':
      return { ...state, loading: true, error: null, emails: [], selectedEmail: null };
    case 'FETCH_EMAILS_SUCCESS':
      return { ...state, loading: false, emails: action.payload };
    case 'FETCH_EMAILS_FAILURE':
      return { ...state, loading: false, error: action.payload };
    case 'SELECT_FOLDER':
      return { ...state, currentFolder: action.payload, selectedEmail: null };
    case 'SELECT_EMAIL':
      if (action.payload === null) {
          return { ...state, selectedEmail: null };
      }
      return { ...state, selectedEmail: state.emails.find(e => e.id === action.payload) || null };
    case 'MARK_AS_READ':
      return {
        ...state,
        emails: state.emails.map(email =>
          email.id === action.payload ? { ...email, read: true } : email
        ),
        selectedEmail: state.selectedEmail?.id === action.payload ? { ...state.selectedEmail, read: true } : state.selectedEmail,
      };
    case 'DELETE_EMAIL':
    case 'MOVE_TO_SPAM':
    case 'DELETE_EMAIL_FOREVER':
        const emailIdToDelete = action.payload;
        return {
            ...state,
            emails: state.emails.filter(e => e.id !== emailIdToDelete),
            selectedEmail: state.selectedEmail?.id === emailIdToDelete ? null : state.selectedEmail,
        };
    case 'START_COMPOSE':
        return { 
            ...state, 
            isComposeOpen: true, 
            composeEmail: action.payload || { recipient: '', subject: '', body: ''} 
        };
    case 'UPDATE_COMPOSE':
        return { ...state, composeEmail: { ...state.composeEmail, ...action.payload } };
    case 'SEND_COMPOSE':
        // If a draft was sent, it will have an ID. Remove it from the list.
        const emailsAfterSend = state.composeEmail.id 
            ? state.emails.filter(e => e.id !== state.composeEmail.id) 
            : state.emails;
        return { ...state, isComposeOpen: false, composeEmail: {}, emails: emailsAfterSend };
    case 'CLOSE_COMPOSE':
        return { ...state, isComposeOpen: false, composeEmail: {} };
    case 'TOGGLE_CHATBOT':
        return { ...state, isChatbotOpen: !state.isChatbotOpen };
    case 'SET_LANGUAGE':
        return { ...state, currentLanguage: action.payload };
    default:
      return state;
  }
};

const AppContext = createContext<{
  state: AppState;
  dispatch: React.Dispatch<Action>;
}>({
  state: initialState,
  dispatch: () => null,
});

export const AppProvider: React.FC<{children: ReactNode}> = ({ children }) => {
  const [state, dispatch] = useReducer(appReducer, initialState);

  useEffect(() => {
    // The firebase.User type is available via the default export from our firebase module.
    const unsubscribe = auth.onAuthStateChanged((user: firebase.User | null) => {
      if (user) {
        const userProfile: UserProfile = {
          uid: user.uid,
          name: user.displayName,
          email: user.email,
          picture: user.photoURL,
        };
        dispatch({ type: 'LOGIN_SUCCESS', payload: userProfile });
      } else {
        dispatch({ type: 'LOGOUT_SUCCESS' });
      }
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (state.isAuthenticated && state.userProfile) {
      dispatch({ type: 'FETCH_EMAILS_START' });
      getEmails(state.userProfile.uid, state.currentFolder)
        .then(emails => {
          dispatch({ type: 'FETCH_EMAILS_SUCCESS', payload: emails });
        })
        .catch(err => {
          console.error("Error fetching emails:", err);
          dispatch({ type: 'FETCH_EMAILS_FAILURE', payload: err.message || 'Failed to fetch emails.' });
        });
    } else if (!state.isAuthenticated) {
        dispatch({ type: 'FETCH_EMAILS_SUCCESS', payload: [] });
    }
  }, [state.isAuthenticated, state.userProfile, state.currentFolder]);
  
  return (
    <AppContext.Provider value={{ state, dispatch }}>
      {children}
    </AppContext.Provider>
  );
};

export const useAppContext = () => useContext(AppContext);