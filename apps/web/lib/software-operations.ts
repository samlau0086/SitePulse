import type {
  InstalledComponent,
  SoftwareCommand,
  SoftwareDirectory,
} from '@sitepulse/api-contracts';

export type OperationPlan = {
  command: SoftwareCommand;
  targets: {
    siteId: string;
    name: string;
    component: InstalledComponent | null;
  }[];
};
export type SoftwarePreviewResult = {
  batchId: string;
  impact: { siteId: string; name: string }[];
  command: SoftwareCommand;
  warning: string;
};
export function actionable(
  item: InstalledComponent,
  action: SoftwareCommand['action'],
) {
  if (item.identifier === 'sitepulse-connector') return false;
  switch (action) {
    case 'activate':
      return !item.active;
    case 'deactivate':
      return item.active;
    case 'uninstall':
      return !item.active;
    case 'update':
      return item.source === 'wordpress.org' && !!item.updateVersion;
    default:
      return false;
  }
}
export function planOperations(
  sites: SoftwareDirectory['sites'],
  kind: SoftwareCommand['kind'],
  action: SoftwareCommand['action'],
  slugs: string[],
): OperationPlan[] {
  return [...new Set(slugs)]
    .map((slug) => ({
      command: { kind, action, slug },
      targets: sites.flatMap<OperationPlan['targets'][number]>((site) => {
        if (!site.enabled) return [];
        const items = kind === 'plugin' ? site.plugins : site.themes;
        const matches = items.filter((item) => item.identifier === slug);
        if (action === 'install')
          return matches.length
            ? []
            : [{ siteId: site.id, name: site.name, component: null }];
        return matches.length === 1 && actionable(matches[0]!, action)
          ? [{ siteId: site.id, name: site.name, component: matches[0]! }]
          : [];
      }),
    }))
    .filter((plan) => plan.targets.length);
}
export function assertUnchangedTargets(
  plan: OperationPlan,
  directory: SoftwareDirectory,
) {
  for (const target of plan.targets) {
    const site = directory.sites.find((row) => row.id === target.siteId);
    const items = plan.command.kind === 'plugin' ? site?.plugins : site?.themes;
    const matches =
      items?.filter((item) => item.identifier === plan.command.slug) ?? [];
    if (
      !site?.enabled ||
      !directory.canManage ||
      matches.length > 1 ||
      JSON.stringify(matches[0] ?? null) !== JSON.stringify(target.component)
    ) {
      throw new Error(
        'A remaining target changed. Stopped; review inventory and create a new confirmation.',
      );
    }
  }
}
type Transport = <T>(
  path: string,
  body?: unknown,
  method?: string,
) => Promise<T>;

// The browser coordinates independent, durable server batches, never concurrent
// mutations on one site. Unsubmitted work intentionally does not survive this page.
export async function executeSoftwarePlans({
  base,
  plans,
  previews,
  reason,
  signal,
  request,
  onDirectory,
  onProgress,
  wait = (signal: AbortSignal) =>
    new Promise<void>((resolve, reject) => {
      const abort = () => {
        clearTimeout(timer);
        reject(
          new Error(
            'Stopped remaining items. Already submitted commands may still execute; inspect Recent operations.',
          ),
        );
      };
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', abort);
        resolve();
      }, 10_000);
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
    }),
}: {
  base: string;
  plans: OperationPlan[];
  previews: SoftwarePreviewResult[];
  reason: string;
  signal: AbortSignal;
  request: Transport;
  onDirectory: (directory: SoftwareDirectory) => void;
  onProgress: (value: string) => void;
  wait?: (signal: AbortSignal) => Promise<void>;
}) {
  const check = () => {
    if (signal.aborted)
      throw new Error(
        'Stopped remaining items. Already submitted commands may still execute; inspect Recent operations.',
      );
  };
  for (let index = 0; index < plans.length; index++) {
    check();
    const plan = plans[index]!;
    const before = await request<SoftwareDirectory>(base, undefined, 'GET');
    onDirectory(before);
    assertUnchangedTargets(plan, before);
    check();
    // Following a successful earlier item, obtain a fresh server-validated
    // fingerprint. Only the immutable, explicitly approved targets are submitted.
    const preview =
      index === 0
        ? previews[0]!
        : await request<SoftwarePreviewResult>(`${base}/preview`, {
            siteIds: plan.targets.map((target) => target.siteId),
            command: plan.command,
            reason,
          });
    check();
    onProgress(
      `Submitting ${index + 1} / ${plans.length}: ${plan.command.action} ${plan.command.slug}`,
    );
    await request(`${base}/${preview.batchId}/confirm`, {});
    if (index === plans.length - 1) break;
    const deadline = Date.now() + 75 * 60_000;
    for (;;) {
      check();
      await wait(signal);
      check();
      const directory = await request<SoftwareDirectory>(
        base,
        undefined,
        'GET',
      );
      onDirectory(directory);
      const operations = directory.operations.filter(
        (op) => op.batchId === preview.batchId,
      );
      if (
        operations.length !== plan.targets.length ||
        operations.some(
          (op) => !['queued', 'running', 'succeeded'].includes(op.status),
        )
      ) {
        throw new Error(
          'Stopped remaining items: an operation failed, expired, was cancelled, has an unknown outcome or is no longer visible. Inspect Recent operations; nothing is automatically retried.',
        );
      }
      const finished = operations.every((op) => op.status === 'succeeded');
      const fresh = plan.targets.every((target) => {
        const site = directory.sites.find((row) => row.id === target.siteId);
        return (
          site?.inventoryAt &&
          site.inventoryAt !==
            before.sites.find((row) => row.id === target.siteId)?.inventoryAt &&
          site.inventorySync.status === 'succeeded'
        );
      });
      if (finished && fresh) break;
      if (Date.now() > deadline)
        throw new Error(
          'Stopped remaining items while waiting for results or fresh inventory. Inspect WordPress before trying again.',
        );
      onProgress(
        `Waiting for ${index + 1} / ${plans.length}: ${plan.command.slug}${finished ? ' — fresh inventory required' : ' — Connector execution'}. Keep this page open.`,
      );
    }
  }
}
