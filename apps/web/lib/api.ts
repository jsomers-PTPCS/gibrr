export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export interface ActorSummary {
  username: string;
  domain: string;
  displayName: string | null;
}

export interface Me {
  actor: ActorSummary & { id: string };
  email: string;
}

export interface Community {
  id: string;
  title: string;
  description: string | null;
  actor: ActorSummary & { id: string };
}

export interface Post {
  id: string;
  title: string;
  url: string | null;
  body: string | null;
  createdAt: string;
  author: ActorSummary;
  community: { title: string; actor: { username: string } };
}

interface FeedResponse {
  posts: Post[];
  nextCursor: string | null;
}

export interface Profile {
  actor: ActorSummary & { id: string; summary: string | null; createdAt: string };
  counts: { followers: number; following: number };
  posts: Post[];
  nextCursor: string | null;
}

class ApiError extends Error {
  constructor(
    public status: number,
    public body: unknown,
  ) {
    super(`API error ${status}`);
  }
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    throw new ApiError(res.status, await res.json().catch(() => null));
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export function getMe() {
  return apiFetch<Me>("/auth/me");
}

export function register(input: { username: string; email: string; password: string }) {
  return apiFetch<Me>("/auth/register", { method: "POST", body: JSON.stringify(input) });
}

export function login(input: { email: string; password: string }) {
  return apiFetch<Me>("/auth/login", { method: "POST", body: JSON.stringify(input) });
}

export function logout() {
  return apiFetch<void>("/auth/logout", { method: "POST" });
}

export function getFeed(cursor?: string) {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  return apiFetch<FeedResponse>(`/feed${query}`);
}

export function getCommunities() {
  return apiFetch<Community[]>("/communities");
}

export function createCommunity(input: { name: string; title: string; description?: string }) {
  return apiFetch<Community>("/communities", { method: "POST", body: JSON.stringify(input) });
}

export function createPost(input: {
  communityId: string;
  title: string;
  url?: string;
  body?: string;
}) {
  return apiFetch<Post>("/posts", { method: "POST", body: JSON.stringify(input) });
}

export function getProfile(username: string, cursor?: string) {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  return apiFetch<Profile>(`/profile/${encodeURIComponent(username)}${query}`);
}

export function updateProfile(input: { displayName?: string; summary?: string }) {
  return apiFetch<Me>("/profile", { method: "PATCH", body: JSON.stringify(input) });
}

export { ApiError };
