import Link from "next/link";
import type { Post } from "../lib/api";

export function PostItem({ post }: { post: Post }) {
  return (
    <li style={{ marginBottom: "1rem" }}>
      <div>
        <strong>{post.title}</strong>
        {post.url && (
          <>
            {" "}
            (
            <a href={post.url} target="_blank" rel="noreferrer">
              {new URL(post.url).hostname}
            </a>
            )
          </>
        )}
      </div>
      {post.body && <p>{post.body}</p>}
      <small>
        submitted by <Link href={`/u/${post.author.username}`}>{post.author.username}</Link> to{" "}
        {post.community.actor.username}
      </small>
    </li>
  );
}
