interface Named {
  name: string;
  createdAt: Date;
}

/** By name ignoring case (accents count), then oldest first. */
export function compareByName(a: Named, b: Named): number {
  return (
    a.name.localeCompare(b.name, 'en', { sensitivity: 'accent' }) ||
    a.createdAt.getTime() - b.createdAt.getTime()
  );
}
