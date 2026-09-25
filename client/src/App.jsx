import Login from "./pages/Login.jsx";
import { useEffect , useState } from "react";
import api from "./api/api.js";
import socket from "./socket/socket.js";
import Chat from "./pages/Chat.jsx";

const App = () => {
    // null = logged out. "Logged in" is derived from this, not stored separately.
    const [currentUser, setCurrentUser] = useState(null);
    // True until we know whether the httpOnly cookie still holds a valid session.
    const [isCheckingSession, setIsCheckingSession] = useState(true);
    const isLoggedIn = currentUser !== null;

    // Restore the session on page load. JavaScript cannot read the httpOnly
    // cookie, so we ask the server who we are.
    useEffect(() => {
        const restoreSession = async () => {
            try {
                const response = await api.get("/auth/me");
                setCurrentUser(response.data.user);
            } catch (error) {
                // 401 just means there is no valid session: show the login page.
                if (error.response?.status !== 401) {
                    console.error("Error restoring session:", error);
                }
            } finally {
                setIsCheckingSession(false);
            }
        };

        restoreSession();
    }, []);

    useEffect(() => {
        if (isLoggedIn) {
            socket.connect();
        }
        return () => {
            socket.disconnect();
        }
    }, [isLoggedIn]);

    const handleLogout = async () => {
        try {
            await api.post("/auth/logout");
            setCurrentUser(null);
        } catch (error) {
            console.error("Error logging out:", error);
        }
    };

    if (isCheckingSession) {
        return <p>Loading...</p>;
    }

  return (
    <div>
      {isLoggedIn ? <Chat currentUser={currentUser} onLogout={handleLogout} /> : <Login setCurrentUser={setCurrentUser} />}
    </div>
  )
}

export default App
