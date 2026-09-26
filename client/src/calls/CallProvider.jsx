import { useEffect, useRef, useState } from "react";
import socket from "../socket/socket.js";
import { useAuth } from "../auth/AuthContext.js";
import { getConversationKey } from "../crypto/hooks.js";
import { decryptMessage, encryptMessage } from "../crypto/messages.js";
import { CallContext } from "./CallContext.js";
import CallOverlay from "./CallOverlay.jsx";

// Public STUN server: tells each browser its public address so the two can
// reach each other directly. (Behind strict networks a TURN relay is needed:
// plan step 41.)
const ICE_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }];
const ENDED_VISIBLE_MS = 3000;

// One voice call at a time. The media goes directly between the two browsers
// (WebRTC, encrypted with DTLS-SRTP). The server only relays the "signals"
// (offer, answer, network candidates), and those are encrypted here with the
// conversation key: the server can't read them or swap in its own keys.
//
// call: null, or { callId, conversationId, peer, direction: "outgoing" |
// "incoming", status: "calling" | "ringing" | "connecting" | "connected" |
// "ended", endReason, connectedAt, muted }
const CallProvider = ({ children }) => {
  const { currentUser, privateKey } = useAuth();
  const [call, setCall] = useState(null);
  const callRef = useRef(null); // the same call, for socket handlers
  const peerConnection = useRef(null);
  const localStream = useRef(null);
  const remoteAudio = useRef(null);
  const pendingCandidates = useRef([]);
  const incomingOffer = useRef(null);
  const endedTimer = useRef(null);

  const update = (changes) => {
    callRef.current = changes === null ? null : { ...callRef.current, ...changes };
    setCall(callRef.current);
  };

  const keyFor = (current) => getConversationKey(privateKey, current.peer.publicKey, current.conversationId);
  const seal = async (current, value) => encryptMessage(await keyFor(current), JSON.stringify(value), currentUser._id);
  // Throws if the signal was changed on the way (AES-GCM checks it).
  const open = async (current, signal) => JSON.parse(await decryptMessage(await keyFor(current), signal, current.peer._id));

  const cleanUp = () => {
    peerConnection.current?.close();
    peerConnection.current = null;
    localStream.current?.getTracks().forEach((track) => track.stop()); // mic indicator off
    localStream.current = null;
    if (remoteAudio.current) remoteAudio.current.srcObject = null;
    pendingCandidates.current = [];
    incomingOffer.current = null;
  };

  // Shows "Call ended" (or why) for a moment, then the overlay goes away.
  const finish = (endReason) => {
    cleanUp();
    if (!callRef.current) return;
    update({ status: "ended", endReason });
    clearTimeout(endedTimer.current);
    endedTimer.current = setTimeout(() => {
      if (callRef.current?.status === "ended") update(null);
    }, ENDED_VISIBLE_MS);
  };

  // Tell the other side, then finish here.
  const hangUp = (reason, shownReason = reason) => {
    const current = callRef.current;
    if (current && current.status !== "ended") {
      socket.emit("endCall", { conversationId: current.conversationId, callId: current.callId, reason });
    }
    finish(shownReason);
  };

  const openMicrophone = async () => {
    localStream.current = await navigator.mediaDevices.getUserMedia({ audio: true });
    return localStream.current;
  };

  const createPeerConnection = (current) => {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    pc.onicecandidate = async (event) => {
      if (!event.candidate) return;
      const candidate = await seal(current, event.candidate.toJSON());
      socket.emit("iceCandidate", { conversationId: current.conversationId, callId: current.callId, candidate });
    };
    pc.ontrack = (event) => {
      if (remoteAudio.current) remoteAudio.current.srcObject = event.streams[0];
    };
    pc.onconnectionstatechange = () => {
      if (pc !== peerConnection.current) return;
      if (pc.connectionState === "connected" && callRef.current?.status !== "connected") {
        update({ status: "connected", connectedAt: Date.now() });
      } else if (pc.connectionState === "failed") {
        hangUp("failed");
      }
    };
    localStream.current.getTracks().forEach((track) => pc.addTrack(track, localStream.current));
    peerConnection.current = pc;
    return pc;
  };

  const addCandidate = async (candidate) => {
    const pc = peerConnection.current;
    if (pc?.remoteDescription) await pc.addIceCandidate(candidate);
    else pendingCandidates.current.push(candidate); // arrived before the offer/answer
  };

  const flushCandidates = async () => {
    const waiting = pendingCandidates.current.splice(0);
    for (const candidate of waiting) await peerConnection.current?.addIceCandidate(candidate);
  };

  // A mic error or a signal that doesn't decrypt ends the call with a reason.
  const failWith = (error) => {
    console.error("Call failed:", error);
    hangUp("failed", error?.name === "NotAllowedError" ? "microphone" : "failed");
  };

  const startCall = async ({ conversationId, peer }) => {
    if (callRef.current && callRef.current.status !== "ended") return;
    clearTimeout(endedTimer.current);
    update(null);
    update({ callId: crypto.randomUUID(), conversationId, peer, direction: "outgoing", status: "calling", muted: false });
    const current = callRef.current;
    try {
      await openMicrophone();
      const pc = createPeerConnection(current);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const encryptedOffer = await seal(current, { type: offer.type, sdp: offer.sdp });
      const response = await socket.timeout(5000).emitWithAck("callUser", { conversationId, callId: current.callId, offer: encryptedOffer });
      if (!response.success) throw new Error(response.message);
    } catch (error) {
      if (callRef.current?.callId === current.callId) failWith(error);
    }
  };

  const acceptCall = async () => {
    const current = callRef.current;
    if (current?.status !== "ringing") return;
    update({ status: "connecting" });
    try {
      await openMicrophone();
      const pc = createPeerConnection(current);
      await pc.setRemoteDescription(await open(current, incomingOffer.current));
      await flushCandidates();
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      const encryptedAnswer = await seal(current, { type: answer.type, sdp: answer.sdp });
      socket.emit("answerCall", { conversationId: current.conversationId, callId: current.callId, answer: encryptedAnswer });
    } catch (error) {
      failWith(error);
    }
  };

  const declineCall = () => hangUp("declined", "you-declined");

  const endCall = () => {
    const current = callRef.current;
    if (!current) return;
    if (current.status === "ended") {
      update(null);
      return;
    }
    hangUp(current.direction === "outgoing" && current.status === "calling" ? "cancelled" : "ended", "you-ended");
  };

  const toggleMute = () => {
    const muted = !callRef.current?.muted;
    localStream.current?.getAudioTracks().forEach((track) => {
      track.enabled = !muted;
    });
    update({ muted });
  };

  // Signals from the other side.
  useEffect(() => {
    const isThisCall = (callId) => callRef.current?.callId === callId && callRef.current.status !== "ended";

    const handleIncoming = ({ callId, conversationId, from, offer }) => {
      if (callRef.current && callRef.current.status !== "ended") {
        socket.emit("endCall", { conversationId, callId, reason: "busy" }); // already in a call
        return;
      }
      clearTimeout(endedTimer.current);
      incomingOffer.current = offer;
      callRef.current = null;
      update({ callId, conversationId, peer: from, direction: "incoming", status: "ringing", muted: false });
    };

    const handleAnswered = async ({ callId, answer }) => {
      if (!isThisCall(callId) || callRef.current.direction !== "outgoing") return;
      update({ status: "connecting" });
      try {
        await peerConnection.current.setRemoteDescription(await open(callRef.current, answer));
        await flushCandidates();
      } catch (error) {
        failWith(error);
      }
    };

    const handleCandidate = async ({ callId, candidate }) => {
      if (!isThisCall(callId)) return;
      try {
        await addCandidate(await open(callRef.current, candidate));
      } catch (error) {
        failWith(error);
      }
    };

    const handleEnded = ({ callId, reason }) => {
      if (isThisCall(callId)) finish(reason);
    };

    // Answered or declined in another of my tabs: stop ringing here.
    const handleElsewhere = ({ callId }) => {
      if (isThisCall(callId) && callRef.current.status === "ringing") {
        cleanUp();
        update(null);
      }
    };

    socket.on("incomingCall", handleIncoming);
    socket.on("callAnswered", handleAnswered);
    socket.on("iceCandidate", handleCandidate);
    socket.on("callEnded", handleEnded);
    socket.on("callHandledElsewhere", handleElsewhere);
    return () => {
      socket.off("incomingCall", handleIncoming);
      socket.off("callAnswered", handleAnswered);
      socket.off("iceCandidate", handleCandidate);
      socket.off("callEnded", handleEnded);
      socket.off("callHandledElsewhere", handleElsewhere);
    };
  }); // re-subscribed each render so handlers see the latest helpers

  // Logging out (or leaving the app) during a call ends it.
  useEffect(() => {
    const timer = endedTimer;
    return () => {
      clearTimeout(timer.current);
      const current = callRef.current;
      if (current && current.status !== "ended") {
        socket.emit("endCall", { conversationId: current.conversationId, callId: current.callId, reason: "ended" });
      }
      peerConnection.current?.close();
      localStream.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  const isBusy = Boolean(call && call.status !== "ended");

  return (
    <CallContext value={{ call, isBusy, startCall, acceptCall, declineCall, endCall, toggleMute }}>
      {children}
      {/* The other person's voice. */}
      <audio ref={remoteAudio} autoPlay hidden />
      {call ? <CallOverlay /> : null}
    </CallContext>
  );
};

export default CallProvider;
