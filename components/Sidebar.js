import React from 'react';
import { useAppContext } from '../context/AppContext.js';
import { Folder } from '../types.js';
import { InboxIcon, SentIcon, SpamIcon, TrashIcon, DraftsIcon, MicIcon } from './icons/IconComponents.js';
import { useTranslations } from '../utils/translations.js';

const SIDEBAR_ITEMS = [
  { name: Folder.INBOX, Icon: InboxIcon },
  { name: Folder.SENT, Icon: SentIcon },
  { name: Folder.DRAFTS, Icon: DraftsIcon },
  { name: Folder.SPAM, Icon: SpamIcon },
  { name: Folder.TRASH, Icon: TrashIcon },
];

const Sidebar = () => {
  const { state, dispatch } = useAppContext();
  const t = useTranslations();

  const handleSelectFolder = (folder) => {
    dispatch({ type: 'SELECT_FOLDER', payload: folder });
  };
  
  const handleCompose = () => {
    dispatch({ type: 'START_COMPOSE' });
  };

  const handleToggleChatbot = () => {
    dispatch({ type: 'TOGGLE_CHATBOT' });
  };

  return (
    React.createElement('nav', { className: "w-64 bg-white p-4 flex flex-col flex-shrink-0 border-r border-gray-200" },
      React.createElement('button', 
        {
          onClick: handleCompose,
          className: "w-full bg-blue-600 text-white text-sm font-semibold py-2.5 px-4 rounded-xl hover:bg-blue-700 transition-all duration-300 mb-6 shadow-lg flex items-center justify-center space-x-2"
        },
        React.createElement('svg', { xmlns: "http://www.w3.org/2000/svg", className: "h-5 w-5", viewBox: "0 0 20 20", fill: "currentColor" },
          React.createElement('path', { d: "M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" })
        ),
        React.createElement('span', null, t('compose'))
      ),
      React.createElement('button',
        {
          onClick: handleToggleChatbot,
          className: `w-full text-sm font-semibold py-2.5 px-4 rounded-xl transition-all duration-300 mb-6 flex items-center justify-center space-x-2 ${
              state.isChatbotOpen ? 'bg-blue-200 text-blue-800' : 'bg-blue-100/70 text-blue-700 hover:bg-blue-200/70'
          }`
        },
        React.createElement(MicIcon, { className: "w-5 h-5" }),
        React.createElement('span', null, t('voiceActive'))
      ),
      React.createElement('ul', null,
        SIDEBAR_ITEMS.map(({ name, Icon }) => (
          React.createElement('li', { key: name },
            React.createElement('button',
              {
                onClick: () => handleSelectFolder(name),
                className: `w-full flex items-center p-2.5 my-1 rounded-lg text-left transition-colors duration-200 text-sm ${
                  state.currentFolder === name
                    ? 'bg-gray-100 text-gray-800 font-semibold'
                    : 'text-gray-700 font-medium hover:bg-gray-100'
                }`
              },
              React.createElement(Icon, { className: "mr-3" }),
              t(name.toLowerCase())
            )
          )
        ))
      )
    )
  );
};

export default Sidebar;