import React from 'react';
import { useAppContext } from '../context/AppContext.js';
import { markEmailAsRead } from '../services/emailService.js';

const EmailListItem = ({ email }) => {
  const { state, dispatch } = useAppContext();
  const { userProfile } = state;
  const isSelected = state.selectedEmail?.id === email.id;

  const handleSelect = () => {
    dispatch({ type: 'SELECT_EMAIL', payload: email.id });
    if (!email.read && userProfile) {
        // Update in Firestore
        markEmailAsRead(userProfile.uid, email.id).catch(err => {
            console.error("Failed to mark email as read in DB:", err);
            // Optionally, revert the optimistic update here
        });
        // Optimistically update UI
        dispatch({ type: 'MARK_AS_READ', payload: email.id });
    }
  };

  return (
    React.createElement('li',
      {
        className: `border-b border-gray-200 cursor-pointer transition-colors duration-200 ${
          isSelected ? 'bg-blue-100/70' : 'hover:bg-gray-50'
        }`
      },
      React.createElement('button', { onClick: handleSelect, className: "w-full text-left p-3" },
        React.createElement('div', { className: "flex justify-between items-baseline" },
          React.createElement('p', { className: `text-sm font-semibold truncate ${email.read ? 'text-gray-600' : 'text-gray-900'}` }, email.sender),
          React.createElement('p', { className: "text-xs text-gray-500 flex-shrink-0 ml-2" }, email.timestamp)
        ),
        React.createElement('p', { className: `text-sm truncate ${email.read ? 'text-gray-600 font-medium' : 'text-gray-800 font-semibold'}` }, email.subject),
        React.createElement('p', { className: "text-xs text-gray-500 truncate mt-1" }, email.body)
      )
    )
  );
};

export default EmailListItem;
