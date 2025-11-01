
import React, { useEffect } from 'react';
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import EmailList from './components/EmailList';
import EmailDetail from './components/EmailDetail';
import ComposeEmail from './components/ComposeEmail';
import { useAppContext } from './context/AppContext';
import { EmptyMailboxIcon } from './components/icons/IconComponents';
import Chatbot from './components/Chatbot';
import Login from './components/Login';
import { useTranslations } from './utils/translations';

const App: React.FC = () => {
  const { state, dispatch } = useAppContext();
  const t = useTranslations();

  useEffect(() => {
    // Automatically open the chatbot when the user logs in and the app is ready.
    if (state.isAuthenticated && !state.loading && !state.isChatbotOpen) {
      dispatch({ type: 'TOGGLE_CHATBOT' });
    }
  }, [state.isAuthenticated, state.loading, state.isChatbotOpen, dispatch]);

  if (state.loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <p className="text-lg text-gray-600">{t('loading')}</p>
      </div>
    );
  }

  if (!state.isAuthenticated) {
    return <Login />;
  }

  return (
    <div className="flex flex-col h-screen w-full bg-white text-gray-800 font-sans">
      <Header />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex flex-1 h-full bg-[#F6F8FC]">
          <EmailList />
          {state.selectedEmail ? (
            <EmailDetail />
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center text-gray-500 p-8">
                <EmptyMailboxIcon className="w-24 h-24 text-gray-300 mb-4" />
                <h2 className="text-xl font-medium">{t('noEmailSelected')}</h2>
                <p>{t('chooseEmailToRead')}</p>
            </div>
          )}
        </main>
      </div>
      {state.isComposeOpen && <ComposeEmail />}
      {state.isChatbotOpen && <Chatbot />}
    </div>
  );
};

export default App;