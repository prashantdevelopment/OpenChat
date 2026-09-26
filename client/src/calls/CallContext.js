import { createContext, useContext } from "react";

// The current call and the actions on it (see CallProvider.jsx).
export const CallContext = createContext(null);

export const useCall = () => useContext(CallContext);
