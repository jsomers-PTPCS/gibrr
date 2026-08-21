export default function PrivacyPage() {
  return (
    <main className="page" style={{ maxWidth: 640 }}>
      <h1>Privacy Policy</h1>
      <div className="card">
        <p className="text-faint">
          This is a starting template, not legal advice — review it with a lawyer before relying
          on it for a real public launch.
        </p>

        <h2 style={{ fontSize: "1.05rem" }}>What we store</h2>
        <p>
          Your email and password (hashed, never stored in plain text), the profile information you
          choose to add, and the Gibs, listens, and other activity you create. Login sessions are
          tracked via a cookie in your browser.
        </p>

        <h2 style={{ fontSize: "1.05rem" }}>What&apos;s public vs. private</h2>
        <p>
          Content you mark public — your profile and public Gibs — is visible to anyone, including
          people on other federated servers, and is delivered to servers that listen to you. Content
          you mark private (whispers, non-public Gibs) is only delivered to its intended
          recipients, but we can&apos;t control what a recipient&apos;s own server does with it once
          delivered.
        </p>

        <h2 style={{ fontSize: "1.05rem" }}>Third parties</h2>
        <p>
          We don&apos;t sell your data. Federation inherently shares public content and public
          profile fields with other independently operated servers per the ActivityPub protocol —
          see the Terms of Service for more on that. If email delivery (verification, password
          reset) is configured, your email address is sent to that mail provider solely to deliver
          those messages.
        </p>

        <h2 style={{ fontSize: "1.05rem" }}>Your data</h2>
        <p>
          To request a copy or deletion of your data, contact us using the information below.
        </p>

        <h2 style={{ fontSize: "1.05rem" }}>Contact</h2>
        <p className="text-faint">[ room host contact info goes here ]</p>
      </div>
    </main>
  );
}
