import { createContext } from "react";

// How many messages are unread across all chats (MessageAlerts). 0 outside
// the logged-in part of the app.
export const UnreadContext = createContext(0);
