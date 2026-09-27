import { io } from "socket.io-client";
import { API_URL } from "../api/api.js";

// No address = this page's own site (see api.js).
const socket = io(API_URL || undefined,
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
