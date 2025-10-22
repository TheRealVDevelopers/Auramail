
import React from 'react';
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import EmailList from './components/EmailList';
import EmailDetail from './components/EmailDetail';
import ComposeEmail from './components/ComposeEmail';
import { useAppContext } from './context/AppContext';
import { EmptyMailboxIcon } from './components/icons/IconComponents';
import Chatbot from './components/Chatbot';
import Login from './components/Login';

const App: React.FC = () => {
  const { state } = useAppContext();

  if (state.loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <p className="text-lg text-gray-600">Loading VoxMail...</p>
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
                <h2 className="text-xl font-medium">No email selected</h2>
                <p>Choose an email from the list to read it.</p>
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
