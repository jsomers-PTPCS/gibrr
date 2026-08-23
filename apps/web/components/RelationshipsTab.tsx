"use client";

import { useEffect, useState, type CSSProperties } from "react";
import Link from "next/link";
import {
  getFriends,
  getFriendRequests,
  getSentFriendRequests,
  acceptFriendRequest,
  removeFriendship,
  getCommunityMemberships,
  getFamilyLinks,
  getFamilyRequests,
  getSentFamilyRequests,
  confirmFamilyLink,
  removeFamilyLink,
  createFamilyLink,
  type ActorSummary,
  type Community,
  type FamilyMember,
  type FamilyLinkRequest,
} from "../lib/api";
import { Avatar } from "./Avatar";
import { FollowPanel } from "./FollowPanel";
import {
  FAMILY_RELATION_TYPES,
  FAMILY_RELATION_LABELS,
  type FamilyRelationType,
} from "../lib/familyRelationTypes";
import { RELATIONSHIP_STATUS_LABELS, type RelationshipStatus } from "../lib/relationshipStatus";
import { useConfirm } from "./ConfirmDialog";

type ActorRow = ActorSummary & { id: string; bookwyrmHandle?: string | null };

function PersonRow({ person }: { person: ActorRow }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
      <Link
        href={`/u/${person.username}`}
        style={{ display: "flex", alignItems: "center", gap: "0.5rem", color: "inherit" }}
      >
        <Avatar name={person.displayName ?? person.username} size={32} />
        <span>{person.displayName ?? person.username}</span>
      </Link>
      {person.bookwyrmHandle && (
        <Link
          href={`/u/${person.username}?tab=bookwyrm`}
          title={`${person.displayName ?? person.username}'s BookWyrm activity`}
          className="pill"
          style={{ fontSize: "0.8rem" }}
        >
          BookWyrm
        </Link>
      )}
    </div>
  );
}

export function RelationshipsTab({
  username,
  isOwnProfile,
  contentBoxStyle,
  relationshipStatus,
}: {
  username: string;
  isOwnProfile: boolean;
  contentBoxStyle?: CSSProperties;
  relationshipStatus: RelationshipStatus | null;
}) {
  const confirm = useConfirm();
  const [friends, setFriends] = useState<ActorRow[] | "loading" | "unavailable">("loading");
  const [friendRequests, setFriendRequests] = useState<ActorRow[]>([]);
  const [sentFriendRequests, setSentFriendRequests] = useState<ActorRow[]>([]);

  const [memberships, setMemberships] = useState<Community[] | "loading">("loading");

  const [familyMembers, setFamilyMembers] = useState<FamilyMember[] | "loading" | "unavailable">(
    "loading",
  );
  const [familyRequests, setFamilyRequests] = useState<FamilyLinkRequest[]>([]);
  const [sentFamilyRequests, setSentFamilyRequests] = useState<FamilyLinkRequest[]>([]);
  const [newRelativeUsername, setNewRelativeUsername] = useState("");
  const [newRelationType, setNewRelationType] = useState<FamilyRelationType>("partner");
  const [familyError, setFamilyError] = useState<string | null>(null);
  const [familyNotice, setFamilyNotice] = useState<string | null>(null);

  useEffect(() => {
    getFriends(username)
      .then(setFriends)
      .catch(() => setFriends("unavailable"));
    getCommunityMemberships(username).then(setMemberships);
    getFamilyLinks(username)
      .then(setFamilyMembers)
      .catch(() => setFamilyMembers("unavailable"));

    if (isOwnProfile) {
      getFriendRequests().then(setFriendRequests);
      getSentFriendRequests().then(setSentFriendRequests);
      getFamilyRequests().then(setFamilyRequests);
      getSentFamilyRequests().then(setSentFamilyRequests);
    }
  }, [username, isOwnProfile]);

  async function handleAcceptFriend(person: ActorRow) {
    await acceptFriendRequest(person.username);
    setFriendRequests((prev) => prev.filter((r) => r.id !== person.id));
    setFriends((prev) => (Array.isArray(prev) ? [...prev, person] : prev));
  }

  async function handleDeclineFriend(person: ActorRow) {
    await removeFriendship(person.username);
    setFriendRequests((prev) => prev.filter((r) => r.id !== person.id));
  }

  async function handleCancelSentFriendRequest(person: ActorRow) {
    await removeFriendship(person.username);
    setSentFriendRequests((prev) => prev.filter((r) => r.id !== person.id));
  }

  async function handleConfirmFamily(request: FamilyLinkRequest) {
    await confirmFamilyLink(request.id);
    setFamilyRequests((prev) => prev.filter((r) => r.id !== request.id));
    setFamilyMembers((prev) =>
      Array.isArray(prev)
        ? [...prev, { id: request.id, person: request.actor, relationType: request.relationType }]
        : prev,
    );
  }

  async function handleDeclineFamily(request: FamilyLinkRequest) {
    await removeFamilyLink(request.id);
    setFamilyRequests((prev) => prev.filter((r) => r.id !== request.id));
  }

  async function handleCancelSentFamily(request: FamilyLinkRequest) {
    await removeFamilyLink(request.id);
    setSentFamilyRequests((prev) => prev.filter((r) => r.id !== request.id));
  }

  async function handleRemoveFamilyMember(member: FamilyMember) {
    if (!(await confirm(`Remove ${member.person.displayName ?? member.person.username} as family?`))) return;
    await removeFamilyLink(member.id);
    setFamilyMembers((prev) => (Array.isArray(prev) ? prev.filter((m) => m.id !== member.id) : prev));
  }

  async function handleAddFamilyMember() {
    setFamilyError(null);
    setFamilyNotice(null);
    if (!newRelativeUsername.trim()) return;
    try {
      await createFamilyLink(newRelativeUsername.trim(), newRelationType);
      setFamilyNotice(`Request sent to @${newRelativeUsername.trim()} — waiting for them to confirm.`);
      setNewRelativeUsername("");
    } catch {
      setFamilyError("could not send that request — check the username and try again");
    }
  }

  const cardStyle = contentBoxStyle;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      <div className="card" style={cardStyle}>
        <h3 style={{ marginTop: 0, fontSize: "1.05rem" }}>Friends</h3>

        {isOwnProfile && friendRequests.length > 0 && (
          <div style={{ marginBottom: "1rem" }}>
            <p className="text-faint" style={{ margin: "0 0 0.5rem" }}>
              Requests
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              {friendRequests.map((person) => (
                <div
                  key={person.id}
                  style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem" }}
                >
                  <PersonRow person={person} />
                  <div style={{ display: "flex", gap: "0.4rem" }}>
                    <button className="btn btn-accent" onClick={() => handleAcceptFriend(person)}>
                      Accept
                    </button>
                    <button className="btn btn-ghost" onClick={() => handleDeclineFriend(person)}>
                      Decline
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {isOwnProfile && sentFriendRequests.length > 0 && (
          <div style={{ marginBottom: "1rem" }}>
            <p className="text-faint" style={{ margin: "0 0 0.5rem" }}>
              Sent
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              {sentFriendRequests.map((person) => (
                <div
                  key={person.id}
                  style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem" }}
                >
                  <PersonRow person={person} />
                  <button className="btn btn-ghost" onClick={() => handleCancelSentFriendRequest(person)}>
                    Cancel
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {friends === "loading" ? (
          <p className="text-dim">Loading…</p>
        ) : friends === "unavailable" ? (
          <p className="text-dim">No friends to show.</p>
        ) : friends.length === 0 ? (
          <p className="text-dim">No friends yet.</p>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: "0.75rem" }}>
            {friends.map((person) => (
              <PersonRow key={person.id} person={person} />
            ))}
          </div>
        )}
      </div>

      <div className="card" style={cardStyle}>
        <h3 style={{ marginTop: 0, fontSize: "1.05rem" }}>Circles</h3>

        {memberships === "loading" ? (
          <p className="text-dim">Loading…</p>
        ) : memberships.length === 0 ? (
          <p className="text-dim">Not a member of any circle yet.</p>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
            {memberships.map((c) => (
              <Link key={c.id} href={`/g/${c.actor.username}`} className="pill">
                {c.actor.username}
              </Link>
            ))}
          </div>
        )}
      </div>

      <div className="card" style={cardStyle}>
        <h3 style={{ marginTop: 0, fontSize: "1.05rem" }}>Family &amp; relationship status</h3>

        {relationshipStatus && (
          <p style={{ margin: "0 0 1rem" }}>{RELATIONSHIP_STATUS_LABELS[relationshipStatus]}</p>
        )}

        {isOwnProfile && familyRequests.length > 0 && (
          <div style={{ marginBottom: "1rem" }}>
            <p className="text-faint" style={{ margin: "0 0 0.5rem" }}>
              Requests
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              {familyRequests.map((request) => (
                <div
                  key={request.id}
                  style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem" }}
                >
                  <span>
                    <PersonRow person={request.actor} /> added you as their{" "}
                    {FAMILY_RELATION_LABELS[request.relationType].toLowerCase()}
                  </span>
                  <div style={{ display: "flex", gap: "0.4rem" }}>
                    <button className="btn btn-accent" onClick={() => handleConfirmFamily(request)}>
                      Confirm
                    </button>
                    <button className="btn btn-ghost" onClick={() => handleDeclineFamily(request)}>
                      Decline
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {isOwnProfile && sentFamilyRequests.length > 0 && (
          <div style={{ marginBottom: "1rem" }}>
            <p className="text-faint" style={{ margin: "0 0 0.5rem" }}>
              Sent
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              {sentFamilyRequests.map((request) => (
                <div
                  key={request.id}
                  style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem" }}
                >
                  <span>
                    You added <PersonRow person={request.actor} /> as your{" "}
                    {FAMILY_RELATION_LABELS[request.relationType].toLowerCase()} — waiting to confirm
                  </span>
                  <button className="btn btn-ghost" onClick={() => handleCancelSentFamily(request)}>
                    Cancel
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {familyMembers === "loading" ? (
          <p className="text-dim">Loading…</p>
        ) : familyMembers === "unavailable" ? (
          <p className="text-dim">No family members to show.</p>
        ) : familyMembers.length === 0 ? (
          <p className="text-dim">No family members added yet.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {familyMembers.map((member) => (
              <div
                key={member.id}
                style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem" }}
              >
                <span style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                  <PersonRow person={member.person} />
                  <span className="text-faint">— {FAMILY_RELATION_LABELS[member.relationType]}</span>
                </span>
                {isOwnProfile && (
                  <button className="btn btn-ghost" onClick={() => handleRemoveFamilyMember(member)}>
                    Remove
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {isOwnProfile && (
          <div style={{ marginTop: "1rem", borderTop: "1px solid var(--border)", paddingTop: "0.75rem" }}>
            <p className="text-faint" style={{ margin: "0 0 0.5rem" }}>
              Add a family member or partner (they'll need to confirm before it shows on either
              profile)
            </p>
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              <input
                className="input"
                placeholder="username"
                value={newRelativeUsername}
                onChange={(e) => setNewRelativeUsername(e.target.value)}
                style={{ flex: 1, minWidth: 140 }}
              />
              <select
                className="input"
                value={newRelationType}
                onChange={(e) => setNewRelationType(e.target.value as FamilyRelationType)}
                style={{ width: 160 }}
              >
                {FAMILY_RELATION_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {FAMILY_RELATION_LABELS[type]}
                  </option>
                ))}
              </select>
              <button className="btn btn-primary" onClick={handleAddFamilyMember}>
                Add
              </button>
            </div>
            {familyNotice && <p className="text-faint" style={{ marginTop: "0.5rem" }}>{familyNotice}</p>}
            {familyError && <p className="error-text" style={{ marginTop: "0.5rem" }}>{familyError}</p>}
          </div>
        )}
      </div>

      <FollowPanel username={username} isOwnProfile={isOwnProfile} contentBoxStyle={cardStyle} />
    </div>
  );
}
