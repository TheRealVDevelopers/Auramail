
import React from 'react';
import { Email, Folder } from '../types';
import { useAppContext } from '../context/AppContext';
import { markEmailAsRead } from '../services/emailService';

interface EmailListItemProps {
  email: Email;
}

const EmailListItem: React.FC<EmailListItemProps> = ({ email }) => {
  const { state, dispatch } = useAppContext();
  const { userProfile } = state;
  const isSelected = state.selectedEmail?.id === email.id;

  const handleSelect = () => {
    if (email.folder === Folder.DRAFTS) {
      dispatch({ type: 'START_COMPOSE', payload: email });
    } else {
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
    }
  };

  return (
    <li
      className={`border-b border-gray-200 cursor-pointer transition-colors duration-200 ${
        isSelected ? 'bg-blue-100/70' : 'hover:bg-gray-50'
      }`}
    >
      <button onClick={handleSelect} className="w-full text-left p-3">
        <div className="flex justify-between items-baseline">
          <p className={`text-sm font-semibold truncate ${email.read ? 'text-gray-600' : 'text-gray-900'}`}>{email.folder === Folder.DRAFTS ? "Draft" : email.sender}</p>
          <p className="text-xs text-gray-500 flex-shrink-0 ml-2">{email.timestamp}</p>
        </div>
        <p className={`text-sm truncate ${email.read ? 'text-gray-600 font-medium' : 'text-gray-800 font-semibold'}`}>{email.subject || '(no subject)'}</p>
        <p className="text-xs text-gray-500 truncate mt-1">{email.body || '(no content)'}</p>
      </button>
    </li>
  );
};

export default EmailListItem;
