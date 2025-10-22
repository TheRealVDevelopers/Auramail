
export interface Email {
  id: string;
  threadId: string;
  sender: string;
  senderEmail: string;
  recipient: string;
  subject: string;
  body: string;
  timestamp: string;
  read: boolean;
  folder: Folder;
}

export enum Folder {
  INBOX = 'Inbox',
  SENT = 'Sent',
  SPAM = 'Spam',
  TRASH = 'Trash',
}

export interface UserProfile {
  uid: string;
  name: string | null;
  email: string | null;
  picture: string | null;
}

export interface Language {
  code: string;
  name: string;
}

export interface Transcript {
  id: string;
  text: string;
  isUser: boolean;
  timestamp: number;
}
