import User, { PUBLIC_USER_FIELDS } from "./models/user.model.js";
import { groupEvents } from "./services/group.service.js";
import { sendPush } from "./services/push.service.js";

// Group invites, live (step 67). What each person is told:
// - the invitee: "groupInvite" with the invite (who, which group), plus a push
//   if OpenChat isn't on their screen; "groupInvitesChanged" when an invite of
//   theirs was answered in another tab or taken back;
// - the inviter: "groupInviteAnswered" (joined or declined);
// - the group's members: "groupsChanged" (members and invites to reload),
//   also when someone leaves or is removed (they too: the group is gone for them);
//   "groupDeleted" when the group ends (an admin deleted it, or the last member left).
// Returns a function that stops listening.
const registerGroupEvents = (io, { userRoom, hasVisibleApp }) => {
    const toMembers = (group) => group.participants.forEach((member) => io.to(userRoom(member)).emit("groupsChanged"));
    const publicUser = (id) => User.findById(id).select(PUBLIC_USER_FIELDS).lean();
    const report = (error) => console.error("Group event:", error.message);

    // Only who invited them (unless they hide senders in pushes) and the
    // group's name; tapping it opens the chat list with the invite on top.
    const pushInvite = async (invite, group, from) => {
        if (await hasVisibleApp(invite.to)) return; // the live alert covers it
        const to = await User.findById(invite.to).select("pushShowSender").lean();
        const showSender = to?.pushShowSender !== false;
        await sendPush(
            String(invite.to),
            {
                title: showSender ? from.name || from.username : "OpenChat",
                body: showSender ? `Invites you to the group "${group.name}"` : "New group invite",
                url: "/chat",
                tag: `invite-${invite._id}`,
            },
            { urgency: "normal", ttlSeconds: 24 * 60 * 60 },
        );
    };

    const onInvited = async ({ group, fromId, invites }) => {
        const from = await publicUser(fromId);
        if (!from) return;
        const summary = { _id: group._id, name: group.name, memberCount: group.participants.length };
        invites.forEach((invite) => {
            io.to(userRoom(invite.to)).emit("groupInvite", { _id: invite._id, group: summary, from, createdAt: invite.createdAt, expiresAt: invite.expiresAt });
            pushInvite(invite, group, from).catch(report);
        });
        toMembers(group);
    };

    const onAnswered = async ({ invite, group, accepted, line }) => {
        const user = await publicUser(invite.to);
        io.to(userRoom(invite.from)).emit("groupInviteAnswered", { inviteId: invite._id, groupId: group._id, groupName: group.name, user, accepted });
        io.to(userRoom(invite.to)).emit("groupInvitesChanged");
        toMembers(group);
        if (accepted) {
            io.to(userRoom(invite.to)).emit("groupsChanged");
            io.to(String(group._id)).emit("newMessage", line);
        }
    };

    const onCancelled = ({ invite, group }) => {
        io.to(userRoom(invite.to)).emit("groupInvitesChanged");
        toMembers(group);
    };

    // (The group as it was: its members still include the one who left.)
    // Their tabs leave the group's room at once: no more messages or typing.
    const onLeft = ({ group, userId, line }) => {
        io.in(userRoom(userId)).socketsLeave(String(group._id));
        io.to(String(group._id)).emit("newMessage", line);
        toMembers(group);
    };

    // Renamed, the invite switch, a new admin: members reload; the line goes to the open chats.
    const onUpdated = ({ group, line }) => {
        if (line) io.to(String(group._id)).emit("newMessage", line);
        toMembers(group);
    };

    // The group is gone: its members' tabs leave its room and close it; open
    // invites to it disappear.
    const onDeleted = ({ group, byId, invitees }) => {
        io.in(String(group._id)).socketsLeave(String(group._id));
        group.participants.forEach((member) => io.to(userRoom(member)).emit("groupDeleted", { groupId: group._id, name: group.name, byId }));
        invitees.forEach((id) => io.to(userRoom(id)).emit("groupInvitesChanged"));
    };

    // A new epoch of the group key: members load it.
    const onKeyChanged = ({ group }) => group.participants.forEach((member) => io.to(userRoom(member)).emit("groupKeyChanged", { groupId: group._id }));

    const handlers = {
        left: onLeft,
        keyChanged: onKeyChanged,
        updated: onUpdated,
        invited: (event) => onInvited(event).catch(report),
        answered: (event) => onAnswered(event).catch(report),
        cancelled: onCancelled,
        deleted: onDeleted,
    };
    Object.entries(handlers).forEach(([name, handler]) => groupEvents.on(name, handler));
    return () => Object.entries(handlers).forEach(([name, handler]) => groupEvents.off(name, handler));
};

export default registerGroupEvents;
