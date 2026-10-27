type SkeletonVariant =
  'overview' | 'directory' | 'workspaces' | 'detail' | 'form';

function Line({ size = '' }: { size?: string }) {
  return <div className={`skeleton-block skeleton-line ${size}`} />;
}

function Panel() {
  return (
    <div className="skeleton-panel">
      <Line size="skeleton-medium" />
      <div className="skeleton-block skeleton-chart" />
      <Line />
      <Line size="skeleton-medium" />
    </div>
  );
}

export function PageSkeleton({
  variant = 'overview',
}: {
  variant?: SkeletonVariant;
}) {
  return (
    <main className="page-skeleton" aria-busy="true" aria-label="Loading page">
      <span className="skeleton-status" role="status">
        Loading page, please wait.
      </span>
      <div aria-hidden="true">
        <div className="page-heading skeleton-heading">
          <div>
            <Line size="skeleton-short" />
            <div className="skeleton-block skeleton-title" />
            <Line />
          </div>
          <div className="skeleton-block skeleton-control" />
        </div>
        {(variant === 'overview' || variant === 'detail') && (
          <div className="metric-grid">
            {Array.from({ length: 4 }, (_, index) => (
              <div className="metric" key={index}>
                <div className="metric-heading">
                  <Line size="skeleton-medium" />
                  <div className="skeleton-block skeleton-icon" />
                </div>
                <div className="skeleton-block skeleton-value" />
              </div>
            ))}
          </div>
        )}
        {variant === 'overview' && (
          <div className="overview-panels">
            <Panel />
            <Panel />
          </div>
        )}
        {(variant === 'overview' || variant === 'workspaces') && (
          <div className="site-card-grid">
            {Array.from({ length: 3 }, (_, index) => (
              <Panel key={index} />
            ))}
          </div>
        )}
        {(variant === 'directory' || variant === 'detail') && (
          <div className="skeleton-panel skeleton-directory">
            <div className="skeleton-toolbar">
              <div className="skeleton-block skeleton-field" />
              <div className="skeleton-block skeleton-control" />
            </div>
            {Array.from({ length: 5 }, (_, index) => (
              <div className="skeleton-row" key={index}>
                <div>
                  <Line />
                  <Line size="skeleton-medium" />
                </div>
                <Line size="skeleton-short" />
                <div className="skeleton-block skeleton-control" />
              </div>
            ))}
          </div>
        )}
        {variant === 'form' && (
          <div className="skeleton-panel skeleton-form">
            {Array.from({ length: 3 }, (_, index) => (
              <div className="skeleton-form-field" key={index}>
                <Line size="skeleton-short" />
                <div className="skeleton-block skeleton-field" />
              </div>
            ))}
            <div className="skeleton-block skeleton-control" />
          </div>
        )}
      </div>
    </main>
  );
}
