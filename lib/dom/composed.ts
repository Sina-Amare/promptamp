/**
 * DOM helpers that follow the browser's composed tree across open shadow roots.
 *
 * `parentElement`, `closest`, `contains`, and `querySelectorAll` all stop at a
 * shadow boundary. That is the wrong ownership model for an extension
 * affordance: a composer may keep its editor in a custom element's shadow tree
 * while its model picker and send button remain in the light DOM.
 */

export function composedParentElement(element: Element): Element | null {
  if (element.parentElement) return element.parentElement;
  const root = element.getRootNode();
  return root instanceof ShadowRoot ? root.host : null;
}

export function closestComposed<T extends Element = Element>(
  element: Element,
  selector: string,
): T | null {
  let current: Element | null = element;
  while (current) {
    const match = current.closest<T>(selector);
    if (match) return match;
    current = composedParentElement(current);
  }
  return null;
}

export function composedContains(
  ancestor: Element,
  descendant: Element,
): boolean {
  let current: Element | null = descendant;
  while (current) {
    if (current === ancestor) return true;
    current = composedParentElement(current);
  }
  return false;
}

/**
 * Query an ordinary subtree and every open shadow subtree it owns.
 *
 * Closed roots intentionally remain opaque. There is no standards-compliant
 * way for an extension to inspect them, so callers retain their safe outside
 * fallback in that case.
 */
export function queryComposedAll<T extends Element = Element>(
  root: ParentNode,
  selector: string,
): T[] {
  const matches = new Set<T>();
  const visitedRoots = new Set<ParentNode>();

  const visit = (scope: ParentNode): void => {
    if (visitedRoots.has(scope)) return;
    visitedRoots.add(scope);

    if (scope instanceof Element && scope.matches(selector)) {
      matches.add(scope as T);
    }
    for (const match of scope.querySelectorAll<T>(selector)) {
      matches.add(match);
    }

    const elements =
      scope instanceof Element
        ? [scope, ...scope.querySelectorAll('*')]
        : [...scope.querySelectorAll('*')];
    for (const element of elements) {
      if (element.shadowRoot) visit(element.shadowRoot);
    }
  };

  visit(root);
  return [...matches];
}

/**
 * Hit-test through open shadow roots.
 *
 * Document-level hit testing commonly returns only the shadow host. Recursing
 * through `ShadowRoot.elementsFromPoint` reveals the actual button/editor
 * under that host without relying on host-specific selectors.
 */
export function composedElementsFromPoint(x: number, y: number): Element[] {
  const elements = new Set<Element>();
  const visitedRoots = new Set<Document | ShadowRoot>();

  const visit = (root: Document | ShadowRoot): void => {
    if (visitedRoots.has(root)) return;
    visitedRoots.add(root);
    if (
      !('elementsFromPoint' in root) ||
      typeof root.elementsFromPoint !== 'function'
    ) {
      return;
    }

    for (const element of root.elementsFromPoint(x, y)) {
      elements.add(element);
      if (element.shadowRoot) visit(element.shadowRoot);
    }
  };

  visit(document);
  return [...elements];
}
