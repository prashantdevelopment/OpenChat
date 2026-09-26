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
// Nobody answers within 30s: the caller gives up ("No answer", a missed call
// for the other side). The callee stops ringing a bit later by itself, in
// case the caller's tab closed without saying so.
const RING_TIMEOUT_MS = 30_000;
const INCOMING_TIMEOUT_MS = 45_000;
const CAMERA = { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } };

// One call at a time, voice or video. The media goes directly between the two
// browsers (WebRTC, encrypted with DTLS-SRTP). The server only relays the
// "signals" (offer, answer, network candidates), and those are encrypted here
// with the conversation key: the server can't read them or swap in its own
// keys. "Muted" and "camera off" travel over a WebRTC data channel, straight
// between the browsers too.
//
// call: null, or { callId, conversationId, peer, media: "audio" | "video",
// direction: "outgoing" | "incoming", status: "calling" | "ringing" |
// "connecting" | "connected" | "ended", endReason, connectedAt, muted,
// cameraOff, peerMuted, peerCameraOff, canSwitchCamera, localStream, remoteStream }
const CallProvider = ({ children }) => {
  const { currentUser, privateKey } = useAuth();
  const [call, setCall] = useState(null);
  const callRef = useRef(null); // the same call, for socket and WebRTC handlers
  const peerConnection = useRef(null);
  const stateChannel = useRef(null);
  const localStream = useRef(null);
  const remoteAudio = useRef(null);
  const pendingCandidates = useRef([]);
  const incomingOffer = useRef(null);
  const endedTimer = useRef(null);
  const ringTimer = useRef(null);
  const offerSent = useRef(false); // the other side was really called: worth a call record

  const update = (changes) => {
    callRef.current = changes === null ? null : { ...callRef.current, ...changes };
    setCall(callRef.current);
  };

  const keyFor = (current) => getConversationKey(privateKey, current.peer.publicKey, current.conversationId);
  const seal = async (current, value) => encryptMessage(await keyFor(current), JSON.stringify(value), currentUser._id);
  // Throws if the signal was changed on the way (AES-GCM checks it).
  const open = async (current, signal) => JSON.parse(await decryptMessage(await keyFor(current), signal, current.peer._id));

  // Tell the other browser whether I'm muted / my camera is off.
  const shareState = () => {
    const current = callRef.current;
    if (stateChannel.current?.readyState === "open" && current) {
      stateChannel.current.send(JSON.stringify({ muted: current.muted, cameraOff: current.cameraOff }));
    }
  };

  const attachStateChannel = (channel) => {
    stateChannel.current = channel;
    channel.onopen = shareState;
    channel.onmessage = (event) => {
      try {
        const { muted, cameraOff } = JSON.parse(event.data);
        update({ peerMuted: Boolean(muted), peerCameraOff: Boolean(cameraOff) });
      } catch {
        // Ignore anything that isn't our small state message.
      }
    };
  };

  const cleanUp = () => {
    clearTimeout(ringTimer.current);
    stateChannel.current?.close();
    stateChannel.current = null;
    peerConnection.current?.close();
    peerConnection.current = null;
    localStream.current?.getTracks().forEach((track) => track.stop()); // mic and camera lights off
    localStream.current = null;
    if (remoteAudio.current) remoteAudio.current.srcObject = null;
    pendingCandidates.current = [];
    incomingOffer.current = null;
  };

  // The caller saves one record of the call in the chat (encrypted like any
  // message): voice/video, answered or not, how long. Only the caller, so
  // there is exactly one.
  const outcomeOf = (current, reason) =>
    current.connectedAt
      ? "completed"
      : ({ "no-answer": "missed", "you-ended": "cancelled", declined: "declined", busy: "busy" }[reason] ?? "failed");

  const saveCallRecord = async (current, reason) => {
    const record = {
      media: current.media,
      outcome: outcomeOf(current, reason),
      duration: current.connectedAt ? (Date.now() - current.connectedAt) / 1000 : 0,
    };
    try {
      const encrypted = await seal(current, record);
      socket.emit("sendMessage", { conversationId: current.conversationId, clientId: crypto.randomUUID(), ...encrypted, messageType: "call" });
    } catch (error) {
      console.error("Could not save the call record:", error);
    }
  };

  // Shows "Call ended" (or why) for a moment, then the overlay goes away.
  const finish = (endReason) => {
    cleanUp();
    if (!callRef.current) return;
    if (callRef.current.direction === "outgoing" && offerSent.current && callRef.current.status !== "ended") {
      saveCallRecord(callRef.current, endReason);
    }
    offerSent.current = false;
    update({ status: "ended", endReason, localStream: null, remoteStream: null });
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

  const openMedia = async (media) => {
    localStream.current = await navigator.mediaDevices.getUserMedia({ audio: true, video: media === "video" ? CAMERA : false });
    const cameras = media === "video" ? (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "videoinput") : [];
    update({ localStream: localStream.current, canSwitchCamera: cameras.length > 1 });
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
      const [stream] = event.streams;
      if (remoteAudio.current) remoteAudio.current.srcObject = stream; // the voice (video elements stay muted)
      update({ remoteStream: stream });
    };
    pc.ondatachannel = (event) => attachStateChannel(event.channel);
    pc.onconnectionstatechange = () => {
      if (pc !== peerConnection.current) return;
      if (pc.connectionState === "connected" && callRef.current?.status !== "connected") {
        clearTimeout(ringTimer.current);
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

  // A blocked mic/camera or a signal that doesn't decrypt ends the call with a reason.
  const failWith = (error) => {
    console.error("Call failed:", error);
    const blocked = error?.name === "NotAllowedError";
    hangUp("failed", blocked ? (callRef.current?.media === "video" ? "camera" : "microphone") : "failed");
  };

  const startCall = async ({ conversationId, peer, media = "audio" }) => {
    if (callRef.current && callRef.current.status !== "ended") return;
    clearTimeout(endedTimer.current);
    offerSent.current = false;
    update(null);
    update({
      callId: crypto.randomUUID(),
      conversationId,
      peer,
      media,
      direction: "outgoing",
      status: "calling",
      muted: false,
      cameraOff: false,
    });
    const current = callRef.current;
    try {
      await openMedia(media);
      const pc = createPeerConnection(current);
      attachStateChannel(pc.createDataChannel("call-state"));
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const encryptedOffer = await seal(current, { type: offer.type, sdp: offer.sdp });
      const response = await socket
        .timeout(5000)
        .emitWithAck("callUser", { conversationId, callId: current.callId, media, offer: encryptedOffer });
      if (!response.success) throw new Error(response.message);
      offerSent.current = true;
      update({ ringing: response.ringing }); // "Ringing..." when their app is open
      ringTimer.current = setTimeout(() => {
        const now = callRef.current;
        if (now?.callId === current.callId && !now.connectedAt && now.status !== "ended") hangUp("missed", "no-answer");
      }, RING_TIMEOUT_MS);
    } catch (error) {
      if (callRef.current?.callId === current.callId) failWith(error);
    }
  };

  const acceptCall = async () => {
    const current = callRef.current;
    if (current?.status !== "ringing") return;
    clearTimeout(ringTimer.current);
    update({ status: "connecting" });
    try {
      await openMedia(current.media);
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
    shareState();
  };

  // Camera off: the track sends black frames; the other side shows my photo instead.
  const toggleCamera = () => {
    const cameraOff = !callRef.current?.cameraOff;
    localStream.current?.getVideoTracks().forEach((track) => {
      track.enabled = !cameraOff;
    });
    update({ cameraOff });
    shareState();
  };

  // Next camera (front/back on phones). replaceTrack swaps what is sent
  // without setting up the call again.
  const switchCamera = async () => {
    const stream = localStream.current;
    const oldTrack = stream?.getVideoTracks()[0];
    const sender = peerConnection.current?.getSenders().find((s) => s.track?.kind === "video");
    if (!oldTrack || !sender) return;
    try {
      const cameras = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "videoinput");
      const index = cameras.findIndex((camera) => camera.deviceId === oldTrack.getSettings().deviceId);
      const next = cameras[(index + 1) % cameras.length];
      const [newTrack] = (await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: next.deviceId } } })).getVideoTracks();
      newTrack.enabled = !callRef.current.cameraOff;
      await sender.replaceTrack(newTrack);
      stream.removeTrack(oldTrack);
      oldTrack.stop();
      stream.addTrack(newTrack);
      update({ localStream: new MediaStream(stream.getTracks()) }); // new object: the preview updates
    } catch (error) {
      console.error("Could not switch camera:", error);
    }
  };

  // Signals from the other side.
  useEffect(() => {
    const isThisCall = (callId) => callRef.current?.callId === callId && callRef.current.status !== "ended";

    const handleIncoming = ({ callId, conversationId, from, media, offer }) => {
      if (callRef.current && callRef.current.status !== "ended") {
        socket.emit("endCall", { conversationId, callId, reason: "busy" }); // already in a call
        return;
      }
      clearTimeout(endedTimer.current);
      incomingOffer.current = offer;
      callRef.current = null;
      update({ callId, conversationId, peer: from, media, direction: "incoming", status: "ringing", muted: false, cameraOff: false });
      ringTimer.current = setTimeout(() => {
        if (callRef.current?.callId === callId && callRef.current.status === "ringing") {
          cleanUp();
          update(null);
        }
      }, INCOMING_TIMEOUT_MS);
    };

    const handleAnswered = async ({ callId, answer }) => {
      if (!isThisCall(callId) || callRef.current.direction !== "outgoing") return;
      clearTimeout(ringTimer.current);
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
    <CallContext value={{ call, isBusy, startCall, acceptCall, declineCall, endCall, toggleMute, toggleCamera, switchCamera }}>
      {children}
      {/* The other person's voice (for video calls too: video elements are muted). */}
      <audio ref={remoteAudio} autoPlay hidden />
      {call ? <CallOverlay /> : null}
    </CallContext>
  );
};

export default CallProvider;
