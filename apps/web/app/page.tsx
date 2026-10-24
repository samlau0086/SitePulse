import Link from 'next/link';
import { getSession } from '../lib/session';

export default async function HomePage() {
  const session = await getSession();
  return (
    <main className="landing">
      <section className="landing-hero" aria-labelledby="hero-title">
        <p className="eyebrow">SITEPULSE / WEBSITE OPERATIONS</p>
        <h1 id="hero-title">
          A little clarity.
          <br />
          For every site you run.
        </h1>
        <p>
          {session
            ? 'Open your workspace to manage connected sites and view their latest inventory.'
            : 'Bring your sites, WordPress inventory and monitoring history into one focused workspace. Less switching tabs. More knowing where things stand.'}
        </p>
        <div className="hero-actions">
          {session ? (
            <Link className="button" href="/app">
              Open workspace
            </Link>
          ) : (
            <>
              <Link className="button" href="/register">
                Create account
              </Link>{' '}
              <Link href="/login">Log in</Link>
            </>
          )}
        </div>
      </section>

      <section
        className="terminal-preview"
        aria-label="Illustrative workspace preview"
      >
        <div className="terminal-title">
          <span>sitepulse / workspace</span>
          <span>ILLUSTRATIVE PREVIEW</span>
        </div>
        <div className="terminal-wordmark" aria-hidden="true">
          [ site/pulse_ ]
        </div>
        <div className="terminal-prompt">
          <span aria-hidden="true">[+] </span>Your operations, at a glance.
        </div>
        <div className="terminal-lines">
          <p>
            <span>[01] Sites</span>One directory. Every workspace.
          </p>
          <p>
            <span>[02] Inventory</span>WordPress, plugins and themes.
          </p>
          <p>
            <span>[03] Monitoring</span>HTTP checks, SSL and incident history.
          </p>
        </div>
        <div className="terminal-footer">
          <span>clear signals / shared context</span>
          <span>built for everyday operations</span>
        </div>
      </section>

      <section className="landing-section" aria-labelledby="features-title">
        <h2 id="features-title">[+] A place for the details that matter.</h2>
        {[
          [
            'Site directory',
            'Find a site by name or hostname, and move between workspaces without losing context.',
          ],
          [
            'WordPress inventory',
            'Review reported versions and available updates from your connected sites.',
          ],
          [
            'Monitoring history',
            'Keep HTTP availability, certificate checks and connector activity clearly in view.',
          ],
        ].map(([title, description]) => (
          <div className="feature-row" key={title}>
            <span aria-hidden="true">[+]</span>
            <strong>{title}</strong>
            <p>{description}</p>
          </div>
        ))}
      </section>
      <footer className="public-footer">
        <span>SitePulse / Website operations</span>
        <span>A quieter way to keep track.</span>
      </footer>
    </main>
  );
}
