export default function Loading() {
  return (
    <main aria-busy="true">
      <div className="empty-state" role="status">
        <h1>Loading your workspace…</h1>
        <p>Retrieving the latest site and monitoring data.</p>
      </div>
    </main>
  );
}
