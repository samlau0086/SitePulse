'use client';
export default function WorkspaceError({ reset }: { reset: () => void }) {
  return (
    <main>
      <div className="empty-state" role="alert">
        <h1>Unable to load this workspace</h1>
        <p>
          Please try again. If the problem continues, check that the application
          services are available.
        </p>
        <button onClick={reset}>Try again</button>
      </div>
    </main>
  );
}
