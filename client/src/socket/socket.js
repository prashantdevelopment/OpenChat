import { io } from "socket.io-client";
const socket = io("http://localhost:5000" ,
    {
        withCredentials: true,
        autoConnect: false,
    }
);

socket.on("connect", () => {
    console.log("Connected to server with ID:", socket.id);
});

socket.on("disconnect", () => {
    console.log("Disconnected from server", socket.id);
});

export default socket;