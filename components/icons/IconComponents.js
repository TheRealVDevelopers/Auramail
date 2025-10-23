import React from 'react';

export const EnvelopeIcon = (props) => (
    React.createElement('svg', { xmlns: "http://www.w3.org/2000/svg", viewBox: "0 0 24 24", fill: "currentColor", ...props },
        React.createElement('path', { d: "M1.5 8.67v8.58a3 3 0 0 0 3 3h15a3 3 0 0 0 3-3V8.67l-8.928 5.493a3 3 0 0 1-3.144 0L1.5 8.67Z" }),
        React.createElement('path', { d: "M22.5 6.908V6.75a3 3 0 0 0-3-3h-15a3 3 0 0 0-3 3v.158l9.714 5.978a1.5 1.5 0 0 0 1.572 0L22.5 6.908Z" })
    )
);

export const LogoEnvelopeIcon = (props) => (
    React.createElement('svg', { xmlns: "http://www.w3.org/2000/svg", viewBox: "0 0 24 24", fill: "currentColor", ...props },
        React.createElement('path', { d: "M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z" })
    )
);

export const InboxIcon = ({ className, ...props }) => (
  React.createElement('svg', { xmlns: "http://www.w3.org/2000/svg", className: `h-4 w-4 ${className || ''}`, fill: "none", viewBox: "0 0 24 24", stroke: "currentColor", strokeWidth: 2, ...props },
    React.createElement('path', { strokeLinecap: "round", strokeLinejoin: "round", d: "M12 4v9m-3-3 3 3 3-3M4 15s4-4 8-4 8 4 8 4" })
  )
);


export const SentIcon = ({ className, ...props }) => (
    React.createElement('svg', { xmlns: "http://www.w3.org/2000/svg", className: `h-4 w-4 ${className || ''}`, fill: "none", viewBox: "0 0 24 24", strokeWidth: 2, stroke: "currentColor", ...props },
        React.createElement('path', { strokeLinecap: "round", strokeLinejoin: "round", d: "M21 3L3 10.5l9 3 3 9 6-19.5Z" })
    )
);

export const DraftsIcon = ({ className, ...props }) => (
    React.createElement('svg', { xmlns: "http://www.w3.org/2000/svg", className: `h-4 w-4 ${className || ''}`, fill: "none", viewBox: "0 0 24 24", strokeWidth: 2, stroke: "currentColor", ...props },
        React.createElement('path', { strokeLinecap: "round", strokeLinejoin: "round", d: "M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" })
    )
);

export const SpamIcon = ({ className, ...props }) => (
    React.createElement('svg', { xmlns: "http://www.w3.org/2000/svg", className: `h-4 w-4 ${className || ''}`, fill: "none", viewBox: "0 0 24 24", strokeWidth: 2, stroke: "currentColor", ...props },
        React.createElement('path', { strokeLinecap: "round", strokeLinejoin: "round", d: "M12 2L4 5v6c0 5.55 3.58 10.74 8 12 4.42-1.26 8-6.45 8-12V5l-8-3z" }),
        React.createElement('path', { strokeLinecap: "round", strokeLinejoin: "round", d: "M12 7v6m0 4v.01" })
    )
);


export const TrashIcon = ({ className, ...props }) => (
  React.createElement('svg', { xmlns: "http://www.w3.org/2000/svg", className: `h-4 w-4 ${className || ''}`, fill: "none", viewBox: "0 0 24 24", stroke: "currentColor", strokeWidth: 2, ...props },
    React.createElement('path', { strokeLinecap: "round", strokeLinejoin: "round", d: "M3 6h18M5 6v14a2 2 0 002 2h10a2 2 0 002-2V6M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m1 0h-1m-1 0H9m5 5v6m-4-6v6" })
  )
);

export const CloseIcon = (props) => (
    React.createElement('svg', { xmlns: "http://www.w3.org/2000/svg", viewBox: "0 0 24 24", fill: "currentColor", className: "w-6 h-6", ...props },
        React.createElement('path', { fillRule: "evenodd", d: "M5.47 5.47a.75.75 0 0 1 1.06 0L12 10.94l5.47-5.47a.75.75 0 1 1 1.06 1.06L13.06 12l5.47 5.47a.75.75 0 1 1-1.06 1.06L12 13.06l-5.47 5.47a.75.75 0 0 1-1.06-1.06L10.94 12 5.47 6.53a.75.75 0 0 1 0-1.06Z", clipRule: "evenodd" })
    )
);

export const SettingsIcon = (props) => (
    React.createElement('svg', { xmlns: "http://www.w3.org/2000/svg", fill: "none", viewBox: "0 0 24 24", strokeWidth: 1.5, stroke: "currentColor", ...props },
        React.createElement('path', { strokeLinecap: "round", strokeLinejoin: "round", d: "M9.594 3.94c.09-.542.56-1.007 1.11-1.226.554-.22 1.196-.22 1.75 0 .554.22 1.02.684 1.11 1.226l.094.542c.063.375.26.717.542.94.282.223.63.344.996.344H16c.552 0 1 .448 1 1v.054c0 .365-.12.714-.343.996-.224.282-.566.478-.94.542l-.542.094c-.542-.09-.944.492-1.226 1.11-.22.554-.22 1.196 0 1.75.22.554.684 1.02 1.226 1.11l.542.094c.375.063.717.26.94.542.223.282.344.63.344.996V18c0 .552-.448 1-1 1h-.054c-.365 0-.714-.12-.996-.343-.282-.224-.478-.566-.542-.94l-.094-.542c-.09-.542-.492-.944-1.11-1.226-.554-.22-1.196-.22-1.75 0-.554.22-1.02.684-1.11 1.226l-.094.542c-.063.375-.26.717-.542.94-.282.223-.63.344-.996.344H8c-.552 0-1-.448-1-1v-.054c0-.365.12-.714.343-.996.224.282.566.478.94-.542l.542-.094c.542-.09.944-.492 1.226-1.11.22-.554.22-1.196 0 1.75-.22-.554-.684-1.02-1.226-1.11l-.542-.094c-.375-.063-.717-.26-.94-.542-.223-.282-.344-.63-.344-.996V6c0-.552.448-1 1-1h.054c.365 0 .714.12.996.343.282.224.478.566.542.94l.094.542Z" }),
        React.createElement('path', { strokeLinecap: "round", strokeLinejoin: "round", d: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" })
    )
);

export const EmptyMailboxIcon = (props) => (
    React.createElement('svg', { xmlns: "http://www.w3.org/2000/svg", fill: "none", viewBox: "0 0 24 24", strokeWidth: 1, stroke: "currentColor", ...props },
      React.createElement('path', { strokeLinecap: "round", strokeLinejoin: "round", d: "M21.75 9v.906a2.25 2.25 0 0 1-1.183 1.981l-6.478 3.488M2.25 9v.906a2.25 2.25 0 0 0 1.183 1.981l6.478 3.488m8.839 2.51-4.66-2.51m0 0-1.023-.55a2.25 2.25 0 0 0-2.134 0l-1.022.55m0 0-4.661 2.51m16.5 1.615a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V8.844a2.25 2.25 0 0 1 1.183-1.981l7.5-4.039a2.25 2.25 0 0 1 2.134 0l7.5 4.039a2.25 2.25 0 0 1 1.183 1.981V18Z" })
    )
);

export const MicIcon = (props) => (
    React.createElement('svg', { xmlns: "http://www.w3.org/2000/svg", viewBox: "0 0 24 24", fill: "currentColor", ...props },
        React.createElement('path', { d: "M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" }),
        React.createElement('path', { d: "M19 10v2a7 7 0 0 1-14 0v-2H3v2a9 9 0 0 0 8 8.94V24h2v-3.06A9 9 0 0 0 21 12v-2h-2Z" })
    )
);

export const PauseIcon = (props) => (
    React.createElement('svg', { xmlns: "http://www.w3.org/2000/svg", viewBox: "0 0 24 24", fill: "currentColor", ...props },
        React.createElement('path', { d: "M6 19h4V5H6v14zm8-14v14h4V5h-4z" })
    )
);

export const PaperAirplaneIcon = (props) => (
    React.createElement('svg', { xmlns: "http://www.w3.org/2000/svg", viewBox: "0 0 24 24", fill: "currentColor", ...props },
        React.createElement('path', { d: "M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" })
    )
);

export const UserIcon = (props) => (
    React.createElement('svg', { xmlns: "http://www.w3.org/2000/svg", fill: "none", viewBox: "0 0 24 24", strokeWidth: 1.5, stroke: "currentColor", ...props },
        React.createElement('path', { strokeLinecap: "round", strokeLinejoin: "round", d: "M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" })
    )
);

export const LockIcon = (props) => (
    React.createElement('svg', { xmlns: "http://www.w3.org/2000/svg", fill: "none", viewBox: "0 0 24 24", strokeWidth: 1.5, stroke: "currentColor", ...props },
      React.createElement('path', { strokeLinecap: "round", strokeLinejoin: "round", d: "M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" })
    )
);

export const SpeakerIcon = (props) => (
    React.createElement('svg', { xmlns: "http://www.w3.org/2000/svg", viewBox: "0 0 24 24", fill: "currentColor", ...props },
        React.createElement('path', { d: "M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" })
    )
);

export const SpeakerOffIcon = (props) => (
    React.createElement('svg', { xmlns: "http://www.w3.org/2000/svg", viewBox: "0 0 24 24", fill: "currentColor", ...props },
        React.createElement('path', { d: "M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z" })
    )
);