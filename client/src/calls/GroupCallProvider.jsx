import { useEffect, useRef, useState } from "react";
import socket from "../socket/socket.js";
import { useAuth } from "../auth/AuthContext.js";
import { getConversationKey } from "../crypto/hooks.js";
import { decryptMessage, encryptMessage } from "../crypto/messages.js";
import { checkPeerKey } from "../crypto/keyPins.js";
import { fetchGroup } from "../lib/groups.js";
import { useCall } from "./CallContext.js";
import { GroupCallContext } from "./GroupCallContext.js";
import GroupCallOverlay from "./GroupCallOverlay.jsx";
import { CAMERA, groupCallState, loadIceServers } from "./media.js";

// Group voice and video calls (step 71), as a mesh: every two people in the
// call have their own WebRTC connection, so the media stays end-to-end
// encrypted (DTLS-SRTP) and never passes the server. The signals between two
// people (offer, answer, network candidates) are encrypted with a key only
// they share: ECDH of their key pairs → HKDF, bound to this call (like the
// 1:1 conversation keys). Whoever joins makes the offers to everyone already
// in the call (so two people never offer to each other at once); that side
// also restarts a connection that drops. Muted / camera off travel over each
// connection's data channel. At most six people (the server checks).
// Nobody whose security key changed is connected to (crypto/keyPins.js).
//
// call: null or { groupId, groupName, callId, media, status: "joining" |
// "in-call" | "ended", endReason, muted, cameraOff, localStream,
// peers: { [userId]: { name, stream, state, muted, cameraOff, keyChanged } } }
const RING_MS = 30_000;
const ENDED_VISIBLE_MS = 2500;
const DISCONNECTED_WAIT_MS = 3000;

const GroupCallProvider = ({ children }) => {
  const { currentUser, privateKey } = useAuth();
  const { isBusy: inOneToOneCall } = useCall();
  const [call, setCall] = useState(null);
  const callRef = useRef(null);
  const [ring, setRing] = useState(null); // { groupId, groupName, callId, media, from }
  const [activeCalls, setActiveCalls] = useState({}); // groupId -> { active, callId, media, participants }
  const links = useRef(new Map()); // userId -> { pc, pending: [], channel, offerer, restartTimer }
  const members = useRef(new Map()); // userId -> { _id, name, username, publicKey }
  const localStream = useRef(null);
  const iceServers = useRef(null);
  const ringTimer = useRef(null);
  const endedTimer = useRef(null);

  const update = (changes) => {
    callRef.current = changes === null ? null : { ...callRef.current, ...changes };
    groupCallState.active = Boolean(callRef.current && callRef.current.status !== "ended");
    setCall(callRef.current);
  };
  const updatePeer = (userId, changes) => {
    const current = callRef.current;
    if (!current) return;
    update({ peers: { ...current.peers, [userId]: { ...current.peers?.[userId], ...changes } } });
  };
  const nameOf = (userId) => {
    const member = members.current.get(userId);
    return member?.name || member?.username || "Someone";
  };

  // The key for my signals with one other person in this call.
  const pairKey = (userId) => {
    const current = callRef.current;
    const pair = [currentUser._id, userId].sort().join("-");
    return getConversationKey(privateKey, members.current.get(userId).publicKey, `groupcall/${current.callId}/${pair}`);
  };
  const sendSignal = async (userId, kind, value) => {
    const current = callRef.current;
    if (!current) return;
    const data = await encryptMessage(await pairKey(userId), JSON.stringify(value), currentUser._id);
    socket.emit("groupCallSignal", { groupId: current.groupId, callId: current.callId, to: userId, kind, data });
  };
  // Throws if the signal was changed on the way (AES-GCM checks it).
  const openSignal = async (userId, data) => JSON.parse(await decryptMessage(await pairKey(userId), data, userId));

  const loadMembers = async (groupId) => {
    const group = await fetchGroup(groupId);
    group.members.forEach((member) => members.current.set(member._id, member));
    return group;
  };
  // Is this person's key the one this device saw before?
  const trusted = async (userId) => {
    const member = members.current.get(userId);
    if (!member?.publicKey) return false;
    const ok = (await checkPeerKey(currentUser._id, userId, member.publicKey)) !== "changed";
    if (!ok) updatePeer(userId, { name: nameOf(userId), keyChanged: true, state: "failed" });
    return ok;
  };

  const shareState = (channel) => {
    const current = callRef.current;
    if (channel?.readyState === "open" && current) channel.send(JSON.stringify({ muted: current.muted, cameraOff: current.cameraOff }));
  };
  const attachChannel = (userId, channel) => {
    const link = links.current.get(userId);
    if (link) link.channel = channel;
    channel.onopen = () => shareState(channel);
    channel.onmessage = (event) => {
      try {
        const { muted, cameraOff } = JSON.parse(event.data);
        updatePeer(userId, { muted: Boolean(muted), cameraOff: Boolean(cameraOff) });
      } catch {
        // Ignore anything that isn't our small state message.
      }
    };
  };

  const closeLink = (userId) => {
    const link = links.current.get(userId);
    clearTimeout(link?.restartTimer);
    link?.channel?.close();
    link?.pc.close();
    links.current.delete(userId);
  };

  // The one who made the offer sends a new one on new routes (ICE restart).
  const restart = async (userId) => {
    const link = links.current.get(userId);
    if (!link?.offerer || !callRef.current) return;
    try {
      const offer = await link.pc.createOffer({ iceRestart: true });
      await link.pc.setLocalDescription(offer);
      await sendSignal(userId, "offer", { type: offer.type, sdp: offer.sdp });
    } catch (error) {
      console.error("Could not restart a group call connection:", error);
    }
  };

  const connect = (userId, { offerer }) => {
    const pc = new RTCPeerConnection({ iceServers: iceServers.current });
    const link = { pc, pending: [], channel: null, offerer, restartTimer: null };
    links.current.set(userId, link);
    updatePeer(userId, { name: nameOf(userId), state: "connecting" });
    pc.onicecandidate = (event) => {
      if (event.candidate) sendSignal(userId, "candidate", event.candidate.toJSON()).catch(() => {});
    };
    pc.ontrack = (event) => updatePeer(userId, { stream: event.streams[0] });
    pc.ondatachannel = (event) => attachChannel(userId, event.channel);
    pc.onconnectionstatechange = () => {
      if (links.current.get(userId)?.pc !== pc) return;
      const state = pc.connectionState;
      updatePeer(userId, { state: state === "connected" ? "connected" : state === "failed" || state === "disconnected" ? "reconnecting" : "connecting" });
      clearTimeout(link.restartTimer);
      if (state === "failed" || state === "disconnected") link.restartTimer = setTimeout(() => restart(userId), state === "failed" ? 0 : DISCONNECTED_WAIT_MS);
    };
    localStream.current.getTracks().forEach((track) => pc.addTrack(track, localStream.current));
    if (offerer) attachChannel(userId, pc.createDataChannel("call-state"));
    return link;
  };

  const flush = async (link) => {
    for (const candidate of link.pending.splice(0)) await link.pc.addIceCandidate(candidate);
  };

  const offerTo = async (userId) => {
    if (!(await trusted(userId))) return;
    const link = connect(userId, { offerer: true });
    const offer = await link.pc.createOffer();
    await link.pc.setLocalDescription(offer);
    await sendSignal(userId, "offer", { type: offer.type, sdp: offer.sdp });
  };

  const stopLocal = () => {
    localStream.current?.getTracks().forEach((track) => track.stop()); // mic and camera lights off
    localStream.current = null;
  };

  const finish = (endReason) => {
    [...links.current.keys()].forEach(closeLink);
    stopLocal();
    if (!callRef.current) return;
    update({ status: "ended", endReason, localStream: null, peers: {} });
    clearTimeout(endedTimer.current);
    endedTimer.current = setTimeout(() => {
      if (callRef.current?.status === "ended") update(null);
    }, ENDED_VISIBLE_MS);
  };

  const leaveCall = () => {
    const current = callRef.current;
    if (current && current.status !== "ended") socket.emit("groupCallLeave", { groupId: current.groupId, callId: current.callId });
    finish("you-left");
  };

  // Start a call in a group, or join the one going on (its media is used).
  const joinGroupCall = async ({ groupId, media }) => {
    if ((callRef.current && callRef.current.status !== "ended") || inOneToOneCall) return;
    clearTimeout(endedTimer.current);
    setRing(null);
    const joining = activeCalls[groupId]?.active ? activeCalls[groupId] : null;
    const useMedia = joining?.media ?? media;
    update(null);
    update({ groupId, groupName: "", callId: joining?.callId ?? crypto.randomUUID(), media: useMedia, status: "joining", muted: false, cameraOff: false, peers: {} });
    try {
      const [group, servers] = await Promise.all([loadMembers(groupId), loadIceServers()]);
      iceServers.current = servers;
      update({ groupName: group.name });
      localStream.current = await navigator.mediaDevices.getUserMedia({ audio: true, video: useMedia === "video" ? CAMERA : false });
      if (callRef.current?.groupId !== groupId || callRef.current.status === "ended") return stopLocal();
      update({ localStream: localStream.current });
      const response = await socket.timeout(5000).emitWithAck("groupCallJoin", { groupId, callId: callRef.current.callId, media: useMedia });
      if (!response.success) {
        finish(response.reason === "full" ? "full" : "failed");
        return;
      }
      update({ callId: response.callId, media: response.media, status: "in-call" });
      for (const userId of response.participants) offerTo(userId).catch((error) => console.error("Group call: could not connect to someone:", error));
    } catch (error) {
      console.error("Group call failed:", error);
      finish(error?.name === "NotAllowedError" ? (useMedia === "video" ? "camera" : "microphone") : "failed");
    }
  };

  const toggleMute = () => {
    const muted = !callRef.current?.muted;
    localStream.current?.getAudioTracks().forEach((track) => (track.enabled = !muted));
    update({ muted });
    links.current.forEach((link) => shareState(link.channel));
  };
  const toggleCamera = () => {
    const cameraOff = !callRef.current?.cameraOff;
    localStream.current?.getVideoTracks().forEach((track) => (track.enabled = !cameraOff));
    update({ cameraOff });
    links.current.forEach((link) => shareState(link.channel));
  };

  // Signals and news from the server.
  useEffect(() => {
    const inThisCall = ({ groupId, callId }) => callRef.current?.groupId === groupId && callRef.current.callId === callId && callRef.current.status === "in-call";

    const handleSignal = async ({ groupId, callId, from, kind, data }) => {
      if (!inThisCall({ groupId, callId })) return;
      try {
        if (!members.current.has(from)) await loadMembers(groupId);
        const value = await openSignal(from, data);
        if (kind === "offer") {
          let link = links.current.get(from);
          if (!link) {
            if (!(await trusted(from))) return;
            link = connect(from, { offerer: false });
          }
          await link.pc.setRemoteDescription(value);
          await flush(link);
          const answer = await link.pc.createAnswer();
          await link.pc.setLocalDescription(answer);
          await sendSignal(from, "answer", { type: answer.type, sdp: answer.sdp });
        } else if (kind === "answer") {
          const link = links.current.get(from);
          await link?.pc.setRemoteDescription(value);
          if (link) await flush(link);
        } else if (kind === "candidate") {
          const link = links.current.get(from);
          if (link?.pc.remoteDescription) await link.pc.addIceCandidate(value);
          else link?.pending.push(value);
        }
      } catch (error) {
        console.error("Group call signal failed:", error);
      }
    };

    const handlePeerJoined = ({ groupId, callId, userId }) => {
      if (!inThisCall({ groupId, callId })) return;
      if (!members.current.has(userId)) loadMembers(groupId).then(() => updatePeer(userId, { name: nameOf(userId) })).catch(() => {});
      updatePeer(userId, { name: nameOf(userId), state: "connecting" }); // they send the offer
    };

    const handlePeerLeft = ({ groupId, callId, userId }) => {
      if (!inThisCall({ groupId, callId })) return;
      closeLink(userId);
      update({ peers: Object.fromEntries(Object.entries(callRef.current.peers ?? {}).filter(([id]) => id !== userId)) });
    };

    const handleElsewhere = ({ groupId, callId }) => {
      if (callRef.current?.groupId === groupId && callRef.current.callId === callId) finish("elsewhere");
    };

    const handleRinging = (event) => {
      if ((callRef.current && callRef.current.status !== "ended") || groupCallState.active) return;
      setRing(event);
      clearTimeout(ringTimer.current);
      ringTimer.current = setTimeout(() => setRing((now) => (now?.callId === event.callId ? null : now)), RING_MS);
    };

    const handleUpdated = (state) => {
      setActiveCalls((prev) => ({ ...prev, [state.groupId]: state }));
      if (!state.active) setRing((now) => (now?.groupId === state.groupId ? null : now));
    };

    // The group was deleted: its call is over.
    const handleGroupDeleted = ({ groupId }) => {
      setRing((now) => (now?.groupId === groupId ? null : now));
      if (callRef.current?.groupId === groupId && callRef.current.status !== "ended") finish("deleted");
    };

    // Reconnected: the server dropped this device from the call meanwhile.
    const handleReconnect = () => {
      if (callRef.current && callRef.current.status !== "ended") finish("lost");
    };

    socket.on("groupCallSignal", handleSignal);
    socket.on("groupCallPeerJoined", handlePeerJoined);
    socket.on("groupCallPeerLeft", handlePeerLeft);
    socket.on("groupCallHandledElsewhere", handleElsewhere);
    socket.on("groupCallRinging", handleRinging);
    socket.on("groupCallUpdated", handleUpdated);
    socket.on("groupDeleted", handleGroupDeleted);
    socket.io.on("reconnect", handleReconnect);
    return () => {
      socket.off("groupCallSignal", handleSignal);
      socket.off("groupCallPeerJoined", handlePeerJoined);
      socket.off("groupCallPeerLeft", handlePeerLeft);
      socket.off("groupCallHandledElsewhere", handleElsewhere);
      socket.off("groupCallRinging", handleRinging);
      socket.off("groupCallUpdated", handleUpdated);
      socket.off("groupDeleted", handleGroupDeleted);
      socket.io.off("reconnect", handleReconnect);
    };
    // The handlers only use refs and stable setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Is a call going on in this group? (Opening a group chat asks.)
  const watchGroupCall = (groupId) =>
    socket
      .timeout(3000)
      .emitWithAck("groupCallState", { groupId })
      .then((state) => state.success && setActiveCalls((prev) => ({ ...prev, [groupId]: state })))
      .catch(() => {});

  // Logging out (the provider goes away): leave the call.
  useEffect(() => () => leaveCall(), []); // eslint-disable-line react-hooks/exhaustive-deps

  const isInGroupCall = Boolean(call && call.status !== "ended");
  const value = { call, ring, activeCalls, isInGroupCall, joinGroupCall, leaveCall, toggleMute, toggleCamera, watchGroupCall, dismissRing: () => setRing(null) };
  return (
    <GroupCallContext value={value}>
      {children}
      <GroupCallOverlay />
    </GroupCallContext>
  );
};

export default GroupCallProvider;
