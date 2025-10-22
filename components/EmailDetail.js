import React from 'react';
import { useAppContext } from '../context/AppContext.js';
import { TrashIcon, SpamIcon } from './icons/IconComponents.js';
import { updateEmailFolder } from '../services/emailService.js';
import { Folder } from '../types.js';

const EmailDetail = () => {
  const { state, dispatch } = useAppContext();
  const { selectedEmail, userProfile } = state;

  if (!selectedEmail) {
    return null; // Should be handled by parent
  }

  const handleDelete = async () => {
    if (!userProfile || !selectedEmail) return;
    try {
        await updateEmailFolder(userProfile.uid, selectedEmail.id, Folder.TRASH);
        dispatch({ type: 'DELETE_EMAIL', payload: selectedEmail.id });
    } catch (error) {
        console.error("Failed to delete email:", error);
    }
  };
  
  const handleSpam = async () => {
    if (!userProfile || !selectedEmail) return;
    try {
        await updateEmailFolder(userProfile.uid, selectedEmail.id, Folder.SPAM);
        dispatch({ type: 'MOVE_TO_SPAM', payload: selectedEmail.id });
    } catch (error) {
        console.error("Failed to mark as spam:", error);
    }
  };

  return (
    React.createElement('div', { className: "flex-1 flex flex-col bg-white" },
      React.createElement('div', { className: "p-4 border-b border-gray-200 flex justify-between items-center" },
        React.createElement('h2', { className: "text-xl font-semibold truncate text-gray-800" }, selectedEmail.subject),
        React.createElement('div', { className: "flex items-center space-x-2" },
            React.createElement('button', { onClick: handleSpam, title: "Mark as Spam", className: "p-2 rounded-full hover:bg-gray-200 transition-colors" }, React.createElement(SpamIcon, { className: "w-5 h-5 text-gray-600" })),
            React.createElement('button', { onClick: handleDelete, title: "Delete Email", className: "p-2 rounded-full hover:bg-gray-200 transition-colors" }, React.createElement(TrashIcon, { className: "w-5 h-5 text-gray-600" }))
        )
      ),
      React.createElement('div', { className: "p-6" },
        React.createElement('div', { className: "flex items-center mb-6" },
          React.createElement('div', { className: "w-10 h-10 bg-blue-500 text-white rounded-full flex-shrink-0 mr-4 flex items-center justify-center font-bold text-xl" },
             selectedEmail.sender.charAt(0)
          ),
          React.createElement('div', null,
            React.createElement('p', { className: "font-semibold text-gray-900" }, selectedEmail.sender),
            React.createElement('p', { className: "text-sm text-gray-500" }, "to ", selectedEmail.recipient)
          ),
          React.createElement('p', { className: "ml-auto text-sm text-gray-500" }, selectedEmail.timestamp)
        )
      ),
      React.createElement('div', { className: "flex-1 p-6 overflow-y-auto text-gray-700 leading-relaxed text-sm", style: { whiteSpace: 'pre-wrap' } },
        React.createElement('p', { dangerouslySetInnerHTML: { __html: selectedEmail.body } })
      )
    )
  );
};

export default EmailDetail;
