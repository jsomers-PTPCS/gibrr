"use client";

import { useEffect, useState, type CSSProperties } from "react";
import {
  getAlbums,
  getAlbum,
  createAlbum,
  updateAlbum,
  deleteAlbum,
  uploadPhoto,
  updatePhoto,
  deletePhoto,
  getImmichAlbums,
  immichAssetUrl,
  API_URL,
  type AlbumSummary,
  type AlbumDetail,
  type Visibility,
  type ImmichAlbum,
} from "../lib/api";
import { useConfirm } from "./ConfirmDialog";

function assetUrl(path: string) {
  return /^https?:\/\//.test(path) ? path : `${API_URL}${path}`;
}

export function PhotosTab({
  username,
  isOwnProfile,
  contentBoxStyle,
}: {
  username: string;
  isOwnProfile: boolean;
  contentBoxStyle?: CSSProperties;
}) {
  const confirm = useConfirm();
  const [albums, setAlbums] = useState<AlbumSummary[] | "loading">("loading");
  const [selectedAlbumId, setSelectedAlbumId] = useState<string | null>(null);
  const [albumDetail, setAlbumDetail] = useState<AlbumDetail | "loading">("loading");

  const [newTitle, setNewTitle] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newVisibility, setNewVisibility] = useState<Visibility>("private");
  const [creating, setCreating] = useState(false);

  const [uploadCaption, setUploadCaption] = useState("");
  const [uploadVisibility, setUploadVisibility] = useState<Visibility>("private");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [immichAlbums, setImmichAlbums] = useState<ImmichAlbum[]>([]);

  const cardStyle = contentBoxStyle;

  useEffect(() => {
    getAlbums(username).then(setAlbums);
    getImmichAlbums(username)
      .then(setImmichAlbums)
      .catch(() => setImmichAlbums([]));
  }, [username]);

  useEffect(() => {
    if (!selectedAlbumId) return;
    setAlbumDetail("loading");
    getAlbum(username, selectedAlbumId).then(setAlbumDetail);
  }, [username, selectedAlbumId]);

  async function refreshAlbums() {
    const list = await getAlbums(username);
    setAlbums(list);
  }

  async function refreshDetail() {
    if (!selectedAlbumId) return;
    const detail = await getAlbum(username, selectedAlbumId);
    setAlbumDetail(detail);
  }

  async function handleCreateAlbum() {
    setError(null);
    if (!newTitle.trim()) return;
    setCreating(true);
    try {
      await createAlbum({
        title: newTitle.trim(),
        description: newDescription.trim() || undefined,
        visibility: newVisibility,
      });
      setNewTitle("");
      setNewDescription("");
      setNewVisibility("private");
      await refreshAlbums();
    } catch {
      setError("failed to create album");
    } finally {
      setCreating(false);
    }
  }

  async function handleDeleteAlbum(albumId: string) {
    if (!(await confirm("Delete this album and all its photos?"))) return;
    await deleteAlbum(albumId);
    setSelectedAlbumId(null);
    await refreshAlbums();
  }

  async function handleAlbumVisibilityChange(albumId: string, visibility: Visibility) {
    await updateAlbum(albumId, { visibility });
    await Promise.all([refreshAlbums(), refreshDetail()]);
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null);
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !selectedAlbumId) return;
    setUploading(true);
    try {
      await uploadPhoto(selectedAlbumId, file, {
        caption: uploadCaption.trim() || undefined,
        visibility: uploadVisibility,
      });
      setUploadCaption("");
      await Promise.all([refreshAlbums(), refreshDetail()]);
    } catch {
      setError("upload failed — is that a valid image file?");
    } finally {
      setUploading(false);
    }
  }

  async function handlePhotoVisibility(photoId: string, visibility: Visibility | null) {
    await updatePhoto(photoId, { visibility });
    await refreshDetail();
  }

  async function handleDeletePhoto(photoId: string) {
    if (!(await confirm("Delete this photo?"))) return;
    await deletePhoto(photoId);
    await Promise.all([refreshAlbums(), refreshDetail()]);
  }

  if (selectedAlbumId) {
    return (
      <div className="card" style={cardStyle}>
        <button className="btn btn-ghost" onClick={() => setSelectedAlbumId(null)} style={{ marginBottom: "0.75rem" }}>
          ‹ Back to albums
        </button>

        {albumDetail === "loading" ? (
          <p className="text-dim">Loading…</p>
        ) : (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ margin: 0, fontSize: "1.1rem" }}>{albumDetail.title}</h3>
              {isOwnProfile && (
                <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                  <select
                    className="input"
                    value={albumDetail.visibility}
                    onChange={(e) => handleAlbumVisibilityChange(selectedAlbumId, e.target.value as Visibility)}
                  >
                    <option value="private">Private</option>
                    <option value="public">Public</option>
                  </select>
                  <button className="btn btn-ghost" onClick={() => handleDeleteAlbum(selectedAlbumId)}>
                    Delete album
                  </button>
                </div>
              )}
            </div>
            {albumDetail.description && (
              <p className="text-faint" style={{ margin: "0.3rem 0 1rem" }}>
                {albumDetail.description}
              </p>
            )}

            {isOwnProfile && (
              <div style={{ margin: "1rem 0", borderTop: "1px solid var(--border)", paddingTop: "0.75rem" }}>
                <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "0.5rem" }}>
                  <input
                    className="input"
                    placeholder="Caption (optional)"
                    value={uploadCaption}
                    onChange={(e) => setUploadCaption(e.target.value)}
                    style={{ flex: 1, minWidth: 160 }}
                  />
                  <select
                    className="input"
                    value={uploadVisibility}
                    onChange={(e) => setUploadVisibility(e.target.value as Visibility)}
                    style={{ width: 140 }}
                  >
                    <option value="private">Private</option>
                    <option value="public">Public</option>
                  </select>
                  <label className="btn btn-primary" style={{ cursor: "pointer" }}>
                    {uploading ? "Uploading…" : "Add photo"}
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleUpload}
                      disabled={uploading}
                      style={{ display: "none" }}
                    />
                  </label>
                </div>
                {error && <p className="error-text">{error}</p>}
              </div>
            )}

            {albumDetail.photos.length === 0 ? (
              <p className="text-dim">No photos yet.</p>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: "0.75rem" }}>
                {albumDetail.photos.map((photo) => (
                  <div key={photo.id}>
                    <img
                      src={assetUrl(photo.thumbnailUrl)}
                      alt={photo.caption ?? ""}
                      style={{ width: "100%", aspectRatio: "1", objectFit: "cover", borderRadius: "var(--radius-sm)" }}
                    />
                    {photo.caption && (
                      <p className="text-faint" style={{ margin: "0.25rem 0 0", fontSize: "0.85rem" }}>
                        {photo.caption}
                      </p>
                    )}
                    {isOwnProfile && (
                      <div style={{ display: "flex", gap: "0.3rem", marginTop: "0.25rem" }}>
                        <select
                          className="input"
                          style={{ fontSize: "0.75rem", padding: "0.2rem" }}
                          value={photo.visibility ?? ""}
                          onChange={(e) =>
                            handlePhotoVisibility(photo.id, (e.target.value || null) as Visibility | null)
                          }
                        >
                          <option value="">Inherit album</option>
                          <option value="public">Public</option>
                          <option value="private">Private</option>
                        </select>
                        <button className="btn btn-ghost" style={{ fontSize: "0.75rem", padding: "0.2rem 0.5rem" }} onClick={() => handleDeletePhoto(photo.id)}>
                          ✕
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      <div className="card" style={cardStyle}>
        <h3 style={{ marginTop: 0, fontSize: "1.05rem" }}>Albums</h3>

        {isOwnProfile && (
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "1rem" }}>
            <input
              className="input"
              placeholder="New album title"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              style={{ flex: 1, minWidth: 140 }}
            />
            <input
              className="input"
              placeholder="Description (optional)"
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              style={{ flex: 1, minWidth: 140 }}
            />
            <select
              className="input"
              value={newVisibility}
              onChange={(e) => setNewVisibility(e.target.value as Visibility)}
              style={{ width: 140 }}
            >
              <option value="private">Private</option>
              <option value="public">Public</option>
            </select>
            <button className="btn btn-primary" disabled={creating} onClick={handleCreateAlbum}>
              {creating ? "Creating…" : "New album"}
            </button>
          </div>
        )}
        {error && <p className="error-text">{error}</p>}

        {albums === "loading" ? (
          <p className="text-dim">Loading…</p>
        ) : albums.length === 0 ? (
          <p className="text-dim">No albums yet.</p>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: "0.75rem" }}>
            {albums.map((album) => (
              <button
                key={album.id}
                onClick={() => setSelectedAlbumId(album.id)}
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-sm)",
                  padding: 0,
                  background: "transparent",
                  cursor: "pointer",
                  textAlign: "left",
                  overflow: "hidden",
                }}
              >
                {album.coverUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={assetUrl(album.coverUrl)}
                    alt={album.title}
                    style={{ width: "100%", aspectRatio: "1", objectFit: "cover", display: "block" }}
                  />
                ) : (
                  <div style={{ width: "100%", aspectRatio: "1", background: "var(--surface-hover)" }} />
                )}
                <div style={{ padding: "0.5rem" }}>
                  <p style={{ margin: 0, fontWeight: 600, fontSize: "0.9rem" }}>{album.title}</p>
                  <p className="text-faint" style={{ margin: "0.15rem 0 0", fontSize: "0.8rem" }}>
                    {album.photoCount} photo{album.photoCount === 1 ? "" : "s"}
                    {album.visibility === "private" ? " · private" : ""}
                  </p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {immichAlbums.length > 0 && (
        <div className="card" style={cardStyle}>
          <h3 style={{ marginTop: 0, fontSize: "1.05rem" }}>From Immich</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: "0.75rem" }}>
            {immichAlbums.map((album) => (
              <div key={album.id}>
                {album.thumbnailAssetId ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={immichAssetUrl(username, album.thumbnailAssetId)}
                    alt={album.title}
                    style={{ width: "100%", aspectRatio: "1", objectFit: "cover", borderRadius: "var(--radius-sm)" }}
                  />
                ) : (
                  <div style={{ width: "100%", aspectRatio: "1", background: "var(--surface-hover)", borderRadius: "var(--radius-sm)" }} />
                )}
                <p style={{ margin: "0.25rem 0 0", fontWeight: 600, fontSize: "0.9rem" }}>{album.title}</p>
                <p className="text-faint" style={{ margin: 0, fontSize: "0.8rem" }}>
                  {album.assetCount} photo{album.assetCount === 1 ? "" : "s"}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
