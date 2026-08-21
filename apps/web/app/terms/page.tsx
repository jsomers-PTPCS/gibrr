export default function TermsPage() {
  return (
    <main className="page" style={{ maxWidth: 640 }}>
      <h1>Terms of Service</h1>
      <div className="card">
        <p className="text-faint">
          This is a starting template, not legal advice — review it with a lawyer before relying
          on it for a real public launch.
        </p>

        <h2 style={{ fontSize: "1.05rem" }}>Your account</h2>
        <p>
          You&apos;re responsible for the content you Gib and the activity on your account. Don&apos;t
          impersonate others, share others&apos; private information without consent, or use the
          service to harass, threaten, or defraud anyone.
        </p>

        <h2 style={{ fontSize: "1.05rem" }}>Federation</h2>
        <p>
          Gibrr is part of the fediverse: Gibs you mark public, and your public profile
          information, can be delivered to and displayed on other, independently operated servers
          you don&apos;t control, including ones that listen to you, ones you listen to, and relays
          this room subscribes to. Deleting a Gib here asks those servers to delete their copy too,
          but we can&apos;t guarantee every server honors that request.
        </p>

        <h2 style={{ fontSize: "1.05rem" }}>Moderation</h2>
        <p>
          We may remove content, suspend accounts, or block other servers from federating with this
          one, at our discretion, to keep the room usable and lawful.
        </p>

        <h2 style={{ fontSize: "1.05rem" }}>No warranty</h2>
        <p>
          The service is provided as-is, without warranty of any kind. We&apos;re not liable for
          content Gibbed by users or for downtime, data loss, or actions taken by other federated
          servers.
        </p>

        <h2 style={{ fontSize: "1.05rem" }}>Changes</h2>
        <p>
          We may update these terms as the service changes. Continued use after an update means you
          accept the revised terms.
        </p>

        <h2 style={{ fontSize: "1.05rem" }}>Contact</h2>
        <p className="text-faint">[ room host contact info goes here ]</p>
      </div>
    </main>
  );
}
