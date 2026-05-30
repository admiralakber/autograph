/** Query a required element, throwing a clear error if the markup drifts. */
export function need<T extends HTMLElement>(root: ParentNode, selector: string): T {
  const el = root.querySelector<T>(selector);
  if (!el) throw new Error(`Autograph: required element not found: ${selector}`);
  return el;
}

/** Query an optional element. */
export function maybe<T extends HTMLElement>(root: ParentNode, selector: string): T | null {
  return root.querySelector<T>(selector);
}
