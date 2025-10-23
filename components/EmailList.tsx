

import React from 'react';
import { useAppContext } from '../context/AppContext';
import EmailListItem from './EmailListItem';
import { EmptyMailboxIcon } from './icons/IconComponents';
import { useTranslations } from '../utils/translations';

const EmailList: React.FC = () => {
  const { state } = useAppContext();
  const t = useTranslations();

  if (state.loading) {
    return (
      <div className="w-1/3 border-r border-gray-200 flex items-center justify-center">
        <p>Loading...</p>
      </div>
    );
  }

  return (
    <div className="w-1/3 border-r border-gray-200 overflow-y-auto bg-white">
      <div className="p-4 border-b border-gray-200 sticky top-0 bg-white/80 backdrop-blur-sm z-10">
        <h2 className="text-lg font-semibold text-gray-800 tracking-tight">{t(state.currentFolder.toLowerCase() as keyof ReturnType<typeof useTranslations>)}</h2>
      </div>
      {state.emails.length > 0 ? (
        <ul>
          {state.emails.map(email => (
            <EmailListItem key={email.id} email={email} />
          ))}
        </ul>
      ) : (
        <div className="p-8 text-center text-gray-400 flex flex-col items-center justify-center h-full">
            <EmptyMailboxIcon className="w-24 h-24 text-gray-300 mb-4" />
            <h2 className="text-xl font-medium text-gray-600">{t('noEmailsYet')}</h2>
            <p>{t('folderIsEmpty')}</p>
        </div>
      )}
    </div>
  );
};

export default EmailList;