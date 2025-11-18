# Mobile compact CSS

This file describes how to load `src/styles/mobile-compact.css` into the app so short mobile viewports show the Save / New Note buttons without scrolling.

Options to enable the CSS (pick one):

1) If your app is React and has an entry `src/index.js` or `src/App.jsx`, add this import near other CSS imports:

```js
import './styles/mobile-compact.css';
```

2) If your app is a static site with `public/index.html` or `public/mobile.html`, add a link tag inside the `<head>`:

```html
<link rel="stylesheet" href="./styles/mobile-compact.css" />
```

Notes:
- The selectors are intentionally generic (e.g. `.app`, `.header`, `.editor`, `.action-bar`). If your project uses different classes, you can adapt the selectors in the CSS or tell me the class names and I will update the stylesheet and PR.
- I did not modify any existing JS/HTML files in this PR to avoid breaking imports when I could not locate the app entry file. If you tell me which file to update (for example `src/index.js` or `public/mobile.html`), I will update it in a follow-up PR/commit.
