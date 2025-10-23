import React from 'react';
import Sidebar from './components/Sidebar.js';
import Header from './components/Header.js';
import EmailList from './components/EmailList.js';
import EmailDetail from './components/EmailDetail.js';
import ComposeEmail from './components/ComposeEmail.js';
import { useAppContext } from './context/AppContext.js';
import { EmptyMailboxIcon } from './components/icons/IconComponents.js';
import Chatbot from './components/Chatbot.js';
import Login from './components/Login.js';
import { useTranslations } from './utils/translations.js';

const App = () => {
  const { state } = useAppContext();
  const t = useTranslations();

  if (state.loading) {
    return (
      React.createElement('div', { className: "flex items-center justify-center h-screen bg-gray-50" },
        React.createElement('p', { className: "text-lg text-gray-600" }, t('loading'))
      )
    );
  }

  if (!state.isAuthenticated) {
    return React.createElement(Login, null);
  }

  return (
    React.createElement('div', { className: "flex flex-col h-screen w-full bg-white text-gray-800 font-sans" },
      React.createElement(Header, null),
      React.createElement('div', { className: "flex flex-1 overflow-hidden" },
        React.createElement(Sidebar, null),
        React.createElement('main', { className: "flex flex-1 h-full bg-[#F6F8FC]" },
          React.createElement(EmailList, null),
          state.selectedEmail ? (
            React.createElement(EmailDetail, null)
          ) : (
            React.createElement('div', { className: "flex-1 flex flex-col items-center justify-center text-center text-gray-500 p-8" },
                React.createElement(EmptyMailboxIcon, { className: "w-24 h-24 text-gray-300 mb-4" }),
                React.createElement('h2', { className: "text-xl font-medium" }, t('noEmailSelected')),
                React.createElement('p', null, t('chooseEmailToRead'))
            )
          )
        )
      ),
      state.isComposeOpen && React.createElement(ComposeEmail, null),
      state.isChatbotOpen && React.createElement(Chatbot, null)
    )
  );
};

export default App;