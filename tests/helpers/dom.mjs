import {Window} from 'happy-dom';
import {act} from 'react';
import {createRoot} from 'react-dom/client';

// Each test gets its own DOM and restores Node's globals on exit. No browser
// profile, IndexedDB or user solution metadata is read by these component tests.
export function createDom(t) {
  const window = new Window({
    url: 'http://analyzer.test/',
    settings: {disableIframePageLoading: true, disableCSSFileLoading: true},
  });
  const values = {
    window, document: window.document,
    HTMLElement: window.HTMLElement, HTMLImageElement: window.HTMLImageElement,
    ResizeObserver: window.ResizeObserver,
    getComputedStyle: window.getComputedStyle.bind(window),
    requestAnimationFrame: window.requestAnimationFrame.bind(window),
    cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const originals = new Map(Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) {
    Object.defineProperty(globalThis, key, {configurable: true, writable: true, value});
  }
  const container = window.document.createElement('div');
  window.document.body.append(container);
  const root = createRoot(container);
  t.after(async () => {
    try {
      await act(async () => root.unmount());
      await window.happyDOM.close();
    } finally {
      for (const [key, original] of originals) {
        if (original) Object.defineProperty(globalThis, key, original);
        else delete globalThis[key];
      }
    }
  });
  return {
    window, container,
    render: element => act(async () => root.render(element)),
    escape: () => act(async () => window.dispatchEvent(new window.KeyboardEvent('keydown', {key: 'Escape'}))),
  };
}
