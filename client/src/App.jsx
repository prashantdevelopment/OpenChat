import Login from "./pages/Login.jsx";
import { useEffect , useState } from "react";
import socket from "./socket/socket.js";
import Chat from "./pages/Chat.jsx";

const App = () => {
    const [isLoggedIn, setIsLoggedIn] = useState(false);
    const [currentUser, setCurrentUser] = useState(null);

    useEffect(() => {
        if (isLoggedIn) {
            socket.connect();
        }
        return () => {
            socket.disconnect();
        }
    }, [isLoggedIn]);

  return (
    <div>
      {isLoggedIn ? <Chat currentUser={currentUser} /> : <Login setIsLoggedIn={setIsLoggedIn} setCurrentUser={setCurrentUser} />}
    </div>
  )
}

export default App