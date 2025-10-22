import React from 'react';
import { useAppContext } from '../context/AppContext.js';
import EmailListItem from './EmailListItem.js';
import { EmptyMailboxIcon } from './icons/IconComponents.js';

const EmailList = () => {
  const { state } = useAppContext();

  if (state.loading) {
    return (
      React.createElement('div', { className: "w-1/3 border-r border-gray-200 flex items-center justify-center" },
        React.createElement('p', null, "Loading...")
      )
    );
  }

  return (
    React.createElement('div', { className: "w-1/3 border-r border-gray-200 overflow-y-auto bg-white" },
      React.createElement('div', { className: "p-4 border-b border-gray-200 sticky top-0 bg-white/80 backdrop-blur-sm z-10" },
        React.createElement('h2', { className: "text-lg font-semibold text-gray-800 tracking-tight" }, state.currentFolder)
      ),
      state.emails.length > 0 ? (
        React.createElement('ul', null,
          state.emails.map(email => (
            React.createElement(EmailListItem, { key: email.id, email: email })
          ))
        )
      ) : (
        React.createElement('div', { className: "p-8 text-center text-gray-400 flex flex-col items-center justify-center h-full" },
            React.createElement(EmptyMailboxIcon, { className: "w-24 h-24 text-gray-300 mb-4" }),
            React.createElement('h2', { className: "text-xl font-medium text-gray-600" }, "No emails yet"),
            React.createElement('p', null, "This folder is empty.")
        )
      )
    )
  );
};

export default EmailList;
