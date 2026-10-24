import { readFile, readdir } from 'node:fs/promises';
import { expect, it } from 'vitest';

it('registers every SQL migration with its matching Drizzle snapshot', async () => {
  const folder = new URL('../migrations/', import.meta.url);
  const journal = JSON.parse(
    await readFile(new URL('meta/_journal.json', folder), 'utf8'),
  ) as {
    entries: Array<{ idx: number; tag: string; when: number }>;
  };
  const files = (await readdir(folder))
    .filter((file) => file.endsWith('.sql'))
    .sort();
  expect(journal.entries.map((entry) => `${entry.tag}.sql`).sort()).toEqual(
    files,
  );
  for (const [index, entry] of journal.entries.entries()) {
    expect(entry.idx).toBe(index);
    if (index > 0)
      expect(entry.when).toBeGreaterThan(journal.entries[index - 1]!.when);
    const snapshot = JSON.parse(
      await readFile(
        new URL(`meta/${entry.tag.slice(0, 4)}_snapshot.json`, folder),
        'utf8',
      ),
    ) as { dialect: string };
    expect(snapshot.dialect).toBe('postgresql');
  }
});
