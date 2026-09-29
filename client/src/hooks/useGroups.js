import { useEffect, useState } from "react";
import socket from "../socket/socket.js";
import { fetchGroups, fetchInvites } from "../lib/groups.js";

// My groups and my open group invites, kept current: a new invite arrives
// live; the lists reload when the server says something changed (someone
// joined, an invite was answered in another tab or taken back) and after a
// reconnect (events sent while offline are lost).
export const useGroups = () => {
  const [groups, setGroups] = useState([]);
  const [invites, setInvites] = useState([]);

  useEffect(() => {
    let ignore = false;
    const loadGroups = () =>
      fetchGroups()
        .then((list) => !ignore && setGroups(list))
        .catch((error) => console.error("Could not load groups:", error));
    const loadInvites = () =>
      fetchInvites()
        .then((list) => !ignore && setInvites(list))
        .catch((error) => console.error("Could not load group invites:", error));
    const loadAll = () => {
      loadGroups();
      loadInvites();
    };
    const handleInvite = (invite) => setInvites((prev) => (prev.some((i) => i._id === invite._id) ? prev : [invite, ...prev]));

    loadAll();
    socket.on("groupInvite", handleInvite);
    socket.on("groupInvitesChanged", loadInvites);
    socket.on("groupsChanged", loadGroups);
    socket.io.on("reconnect", loadAll);
    return () => {
      ignore = true;
      socket.off("groupInvite", handleInvite);
      socket.off("groupInvitesChanged", loadInvites);
      socket.off("groupsChanged", loadGroups);
      socket.io.off("reconnect", loadAll);
    };
  }, []);

  return { groups, setGroups, invites, setInvites };
};
