// Fix: Update Firebase imports to use the v9 compatibility layer ('compat') to match the v8 SDK API.
import firebase from 'firebase/compat/app';
import 'firebase/compat/firestore';
import 'firebase/compat/auth';
import { db } from '../firebase';
import { Email, Folder } from '../types';

const getEmailsCollection = (userId: string) => db.collection('users').doc(userId).collection('emails');
const getUsersCollection = () => db.collection('users');
const getUsernamesCollection = () => db.collection('usernames');

/**
 * Gets the count of unread emails in a specific folder.
 * This requires a composite index on (folder, read) in Firestore.
 */
export const getUnreadCount = async (userId: string, folder: Folder): Promise<number> => {
    try {
        const emailsCol = getEmailsCollection(userId);
        // Fix: Use v8 `where` and `get` methods. Replace `getCountFromServer` with `snapshot.size`.
        const q = emailsCol.where('folder', '==', folder).where('read', '==', false);
        const snapshot = await q.get();
        return snapshot.size;
    } catch (error) {
        console.error("Error getting unread count:", error);
        // This error often indicates a missing Firestore index.
        // The console will provide a link to create it.
        return 0;
    }
};


/**
 * Sets up a new user by creating their profile document, claiming their username, and seeding initial emails.
 */
// Fix: Use `firebase.User` type from v8 SDK.
export const setupNewUser = async (user: firebase.User, username: string): Promise<void> => {
    const normalizedUsername = username.trim().toLowerCase();

    // Use a batch write to ensure atomic operation
    const batch = db.batch();

    // 1. Create user profile document
    const userDocRef = db.collection('users').doc(user.uid);
    batch.set(userDocRef, {
        uid: user.uid,
        email: user.email?.trim().toLowerCase() || null,
        username: normalizedUsername,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });

    // 2. Create username document to enforce uniqueness and for lookups
    const usernameDocRef = db.collection('usernames').doc(normalizedUsername);
    batch.set(usernameDocRef, { uid: user.uid });
    
    // Commit the batch
    await batch.commit();

    // 3. Update the user's profile in Firebase Auth itself
    await user.updateProfile({
        displayName: username.trim(), // Use the original casing for display
    });

    // 4. Seed initial emails for the new user
    await seedEmailsForNewUser(user.uid);
};


/**
 * Finds a user's UID by their email address, searching in a case-insensitive and whitespace-insensitive manner.
 * @returns The user's UID string, or null if not found.
 */
const findUserByEmail = async (email: string): Promise<string | null> => {
    const usersCol = getUsersCollection();
    // Normalize the input email by trimming whitespace and converting to lowercase to match the stored format.
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
        return null; // Don't query for an empty or whitespace-only string
    }
    // Fix: Use v8 `where` and `get` methods.
    const q = usersCol.where('email', '==', normalizedEmail);
    const querySnapshot = await q.get();

    if (querySnapshot.empty) {
        return null;
    }
    // Assuming email is unique, there should be only one document.
    return querySnapshot.docs[0].id;
};


/**
 * Finds a user's UID by their username.
 * @returns The user's UID string, or null if not found.
 */
const findUserByUsername = async (username: string): Promise<string | null> => {
    const normalizedUsername = username.trim().toLowerCase();
    if (!normalizedUsername) return null;
    
    const usernameDoc = await getUsernamesCollection().doc(normalizedUsername).get();
    if (usernameDoc.exists) {
        return usernameDoc.data()?.uid || null;
    }
    return null;
};


export const getEmails = async (userId: string, folder: Folder): Promise<Email[]> => {
    const emailsCol = getEmailsCollection(userId);
    // Fix: Use v8 `where` and `get` methods.
    const q = emailsCol.where('folder', '==', folder);
    const querySnapshot = await q.get();

    // Map to an intermediate array that includes the original Date object for reliable sorting.
    const tempEmails = querySnapshot.docs.map(doc => {
        const data = doc.data();
        // Fix: Use `firebase.firestore.Timestamp` for type casting
        const date = (data.timestamp as firebase.firestore.Timestamp)?.toDate() ?? new Date();
        // Fix: Nest the document data instead of spreading it. Spreading a `DocumentData`
        // object can cause TypeScript to lose track of the specific properties, leading to
        // type errors in subsequent operations.
        return {
            data: data,
            id: doc.id,
            date: date,
        };
    });

    // Sort the intermediate array by the Date object, descending.
    tempEmails.sort((a, b) => b.date.getTime() - a.date.getTime());

    // Map to the final Email[] format, converting the timestamp to a string for display.
    const emails: Email[] = tempEmails.map(item => ({
        id: item.id,
        // Fix: Access properties from the nested `data` object to resolve property not found errors.
        threadId: item.data.threadId,
        sender: item.data.sender,
        senderEmail: item.data.senderEmail,
        recipient: item.data.recipient,
        subject: item.data.subject,
        body: item.data.body,
        read: item.data.read,
        folder: item.data.folder,
        timestamp: item.date.toLocaleString(),
    }));
    
    return emails;
};

export const sendEmail = async (senderUid: string, email: Partial<Email>): Promise<{ success: boolean; message: string; }> => {
    // Step 1: Always save to the sender's "Sent" folder first.
    try {
        const sentEmailData = {
            ...email,
            folder: Folder.SENT,
            read: true,
            // Fix: Use `firebase.firestore.FieldValue.serverTimestamp()`
            timestamp: firebase.firestore.FieldValue.serverTimestamp(),
        };
        const senderEmailsCol = getEmailsCollection(senderUid);
        // Fix: Use v8 `.add()` method
        await senderEmailsCol.add(sentEmailData);
    } catch (error) {
        console.error("Critical Error: Failed to save email to Sent folder.", error);
        return { success: false, message: "Could not save the email to your Sent folder. Please check your connection or permissions." };
    }

    if (!email.recipient) {
        return { success: true, message: 'Email saved to Sent folder.' };
    }

    // Step 2: Try to deliver to the recipient by username or email.
    try {
        let recipientUid: string | null = null;
        const recipientIdentifier = email.recipient.trim();

        if (recipientIdentifier.includes('@')) {
            recipientUid = await findUserByEmail(recipientIdentifier);
        } else {
            recipientUid = await findUserByUsername(recipientIdentifier);
        }

        if (recipientUid) {
             // Handle sending to self
            if (recipientUid === senderUid) {
                const selfInboxEmailData = { ...email, folder: Folder.INBOX, read: false, timestamp: firebase.firestore.FieldValue.serverTimestamp() };
                await getEmailsCollection(senderUid).add(selfInboxEmailData);
                return { success: true, message: 'Email sent successfully to yourself!' };
            }

            // Deliver a copy to recipient's inbox
            const receivedEmailData = { ...email, folder: Folder.INBOX, read: false, timestamp: firebase.firestore.FieldValue.serverTimestamp() };
            await getEmailsCollection(recipientUid).add(receivedEmailData);
            return { success: true, message: 'Email sent successfully!' };
        } else {
            return { success: false, message: `Email saved to Sent, but recipient "${email.recipient}" was not found in VoxMail.` };
        }
    } catch (error: any) {
        console.error("Delivery Error:", error);
        return { 
            success: false, 
            message: `CRITICAL: Email delivery failed due to a database error. This usually means a database index is missing. Please OPEN THE DEVELOPER CONSOLE (F12), find the error message, and CLICK THE LINK in it to create the required index. Your email has been saved in 'Sent'.` 
        };
    }
};


export const updateEmailFolder = async (userId: string, emailId: string, folder: Folder): Promise<void> => {
    // Fix: Use v8 method chaining to get doc ref and `.update()` method
    const emailDoc = db.collection('users').doc(userId).collection('emails').doc(emailId);
    await emailDoc.update({ folder });
};

export const markEmailAsRead = async (userId: string, emailId: string): Promise<void> => {
    // Fix: Use v8 method chaining to get doc ref and `.update()` method
    const emailDoc = db.collection('users').doc(userId).collection('emails').doc(emailId);
    await emailDoc.update({ read: true });
};

export const seedEmailsForNewUser = async (userId: string): Promise<void> => {
    const emailsCol = getEmailsCollection(userId);
    // Fix: Remove v9 `query` and use collection ref directly for `get`
    const q = emailsCol;
    const snapshot = await q.get();
    
    if (snapshot.empty) {
        console.log(`Seeding emails for new user: ${userId}`);
        const userDoc = await db.collection('users').doc(userId).get();
        const userEmail = userDoc.data()?.email || 'you@example.com';

        // Fix: Use v8 `db.batch()`
        const batch = db.batch();

        const MOCK_EMAILS_TEMPLATE: Omit<Email, 'id' | 'timestamp' | 'recipient'>[] = [
          {
            threadId: 't1',
            sender: 'GitHub',
            senderEmail: 'noreply@github.com',
            subject: '[voxmail] Your build has passed!',
            body: 'Your recent commit to the main branch of voxmail has passed all checks. Great job!',
            read: false,
            folder: Folder.INBOX,
          },
          {
            threadId: 't2',
            sender: 'Figma',
            senderEmail: 'team@figma.com',
            subject: 'Updates to our collaboration features',
            body: 'Hi there, we have some exciting new updates to make collaboration even smoother. Check out our latest blog post to learn more.',
            read: false,
            folder: Folder.INBOX,
          },
          {
            threadId: 't3',
            sender: 'Alice',
            senderEmail: 'alice@example.com',
            subject: 'Lunch on Friday?',
            body: 'Hey! Are you free for lunch this Friday? I was thinking we could try that new cafe downtown. Let me know!',
            read: true,
            folder: Folder.INBOX,
          },
        ];

        MOCK_EMAILS_TEMPLATE.forEach(email => {
            // Fix: Use v8 `.doc()` to create a new doc ref for a batch
            const docRef = emailsCol.doc();
            batch.set(docRef, { ...email, recipient: userEmail, timestamp: firebase.firestore.FieldValue.serverTimestamp() });
        });

        await batch.commit();
    }
};