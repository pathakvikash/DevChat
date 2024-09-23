/**
 * Joins multiple class names together, but only if they are truthy.
 * Any undefined, null, or false values are ignored.
 * @param classes - The class names to join.
 * @returns The joined class names.
 */
export function cn(...classes: (string | undefined | null | false)[]) {
  return classes.filter(Boolean).join(' ');
}
