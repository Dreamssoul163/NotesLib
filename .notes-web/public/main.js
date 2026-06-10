async function apiList(relPath) {
  const url = '/api/list?path=' + encodeURIComponent(relPath || '');
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to list');
  return res.json();
}

async function ensurePdfJs() {
  if (window.pdfjsLib) return;
  const tryLoad = (src) => new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Failed to load script: ' + src));
    document.head.appendChild(s);
  });
  // Try local vendor first (avoids browser tracking-prevention blocking CDN), then fall back to CDN
  try {
    await tryLoad('/vendor/pdfjs/pdf.min.js');
    if (!window.pdfjsLib) throw new Error('pdfjs not available after local load');
    pdfjsLib.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.js';
    return;
  } catch (eLocal) {
    try {
      await tryLoad('https://unpkg.com/pdfjs-dist/build/pdf.min.js');
      if (!window.pdfjsLib) throw new Error('pdfjs not available after CDN load');
      pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://unpkg.com/pdfjs-dist/build/pdf.worker.min.js';
      return;
    } catch (eCdn) {
      throw new Error('Failed to load pdf.js from local vendor and CDN');
    }
  }
}

function createNode(item) {
  const li = document.createElement('div');
  li.className = 'node';
  const label = document.createElement('div');
  label.className = 'label';
  // expose the path on the DOM so we can programmatically select items
  if (item.path) label.dataset.path = item.path;
  const name = document.createElement('span');
  // display name: strip `.pdf` suffix for files to make sidebar cleaner
  let displayName = item.name || '/';
  if (!item.isDirectory) {
    displayName = displayName.replace(/\.pdf$/i, '');
  }
  // remove leading two-digit prefix and following space used for sorting, e.g. "01 Foo" -> "Foo"
  displayName = displayName.replace(/^[0-9]{2}\s+/, '');
  name.textContent = displayName;

  label.appendChild(name);
  li.appendChild(label);

  if (item.isDirectory) {
    label.classList.add('dir');
    const toggle = document.createElement('button');
    toggle.textContent = '+';
    toggle.className = 'toggle';
    label.insertBefore(toggle, name);
    const childrenWrap = document.createElement('div');
    childrenWrap.className = 'children';
    li.appendChild(childrenWrap);

    let loaded = false;
    toggle.addEventListener('click', async (e) => {
      // prevent the click from bubbling to the label which also toggles
      if (e && e.stopPropagation) e.stopPropagation();
      // determine current visibility using computed style (robust when inline style is empty)
      const isVisible = window.getComputedStyle(childrenWrap).display !== 'none';

      // Lazy-load children on first expansion
      if (!loaded) {
        try {
          const data = await apiList(item.path);
          data.items.forEach(it => {
            const child = createNode(it);
            childrenWrap.appendChild(child);
          });
          loaded = true;
          // ensure visible after load
          childrenWrap.style.display = 'block';
          toggle.textContent = '-';
          return;
        } catch (e) {
          alert('无法读取目录');
          return;
        }
      }

      // If currently visible, collapse; otherwise expand.
      if (isVisible) {
        childrenWrap.style.display = 'none';
        toggle.textContent = '+';
      } else {
        childrenWrap.style.display = 'block';
        toggle.textContent = '-';
      }
    });

    // allow clicking the whole label (not just the small toggle) to expand/collapse
    label.addEventListener('click', (e) => {
      // if the click originated on a child interactive element, let it behave normally
      if (e && e.target && e.target.closest && e.target.closest('.toggle')) return;
      // simulate toggle click to reuse the same logic
      try { toggle.click(); } catch (err) {}
    });
  } else {
    label.classList.add('file');
    label.addEventListener('click', () => {
      openFile(item.path);
      const prev = document.querySelector('.label.selected');
      if (prev) prev.classList.remove('selected');
      label.classList.add('selected');
      try { updateSelectedParents(item.path); } catch (e) {}
    });
  }
  return li;
}

// Programmatically select a file in the tree by its relative path and
// expand any ancestor directories so it's visible.
function selectTreeItem(relPath) {
  if (!relPath) return;
  const labels = Array.from(document.querySelectorAll('.label[data-path]'));
  const target = labels.find(l => l.dataset.path === relPath);
  if (!target) return;
  // expand ancestor nodes
  let cur = target.parentElement; // .node
  while (cur) {
    if (cur.classList && cur.classList.contains('node')) {
      const toggle = cur.querySelector(':scope > .label > .toggle');
      const children = cur.querySelector(':scope > .children');
      if (children) {
        children.style.display = 'block';
        if (toggle) toggle.textContent = '-';
      }
    }
    cur = cur.parentElement && cur.parentElement.closest ? cur.parentElement.closest('.node') : cur.parentElement;
    // stop if we've reached the root tree element
    if (!cur || cur.id === 'tree') break;
  }
  const prev = document.querySelector('.label.selected');
  if (prev) prev.classList.remove('selected');
  target.classList.add('selected');
  // ensure visible
  try { target.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (e) {}
  try { updateSelectedParents(relPath); } catch (e) {}
}

// Expand ancestor directories and select the target file.
// Handles lazy-loaded directories by triggering their toggle and waiting for children.
async function revealAndSelectTreePath(relPath) {
  if (!relPath) return;
  const parts = relPath.replace(/\\/g, '/').split('/').filter(Boolean);

  // expand each ancestor directory from the root down
  for (let depth = 1; depth < parts.length; depth++) {
    const dirPath = parts.slice(0, depth).join('/');
    const labels = Array.from(document.querySelectorAll('.label[data-path]'));
    const dirLabel = labels.find(l => l.dataset.path === dirPath);
    if (!dirLabel) break;

    const node = dirLabel.closest('.node');
    if (!node) break;
    const childrenWrap = node.querySelector(':scope > .children');
    if (!childrenWrap) break;

    const isVisible = window.getComputedStyle(childrenWrap).display !== 'none';
    const hasChildren = childrenWrap.children.length > 0;

    if (!isVisible || !hasChildren) {
      const toggle = dirLabel.querySelector('.toggle');
      if (toggle) {
        toggle.click();
        // poll until children appear (lazy fetch) or timeout (1 s)
        for (let i = 0; i < 10; i++) {
          await new Promise(r => setTimeout(r, 100));
          if (childrenWrap.children.length > 0) break;
        }
      }
    }
  }

  selectTreeItem(relPath);
}

// highlight ancestor directory labels for a given selected file path
function updateSelectedParents(relPath) {
  // clear previous
  document.querySelectorAll('.label.selected-parent').forEach(el => el.classList.remove('selected-parent'));
  if (!relPath) return;
  const labels = Array.from(document.querySelectorAll('.label[data-path]'));
  const target = labels.find(l => l.dataset.path === relPath);
  if (!target) return;
  // climb ancestors and mark their label as selected-parent
  let node = target.closest('.node');
  while (node) {
    const parent = node.parentElement && node.parentElement.closest ? node.parentElement.closest('.node') : null;
    if (!parent) break;
    const parentLabel = parent.querySelector(':scope > .label');
    if (parentLabel) parentLabel.classList.add('selected-parent');
    node = parent;
  }
}

// Safely decode a potentially percent-encoded path. If decode fails,
// return the original string. This prevents double-encoding when we
// later call `encodeURIComponent` to build the `/file?path=` URL.
function safeDecodePath(p) {
  if (!p || typeof p !== 'string') return p;
  // quick check: if it contains percent-escapes, attempt decode
  try {
    // If it looks percent-encoded, decode once
    let decoded = p.indexOf('%') !== -1 ? decodeURIComponent(p) : p;
    // Detect common mojibake pattern where UTF-8 bytes were interpreted as
    // Latin-1/Windows-1252. These often include characters in the U+00C0..U+00FF
    // range (e.g. 'Ã', 'Â', etc). If detected, attempt a recovery using the
    // escape/decodeURIComponent trick to reinterpret the bytes as UTF-8.
    if (/[ -]*[ -]/.test(decoded)) {
      // noop; keep decoded as-is
    }
    const hasHighLatin = /[\u00C0-\u00FF]/.test(decoded);
    if (hasHighLatin) {
      try {
        // escape() will percent-encode the raw 0x00-0xFF bytes; then
        // decodeURIComponent will interpret them as UTF-8 and produce
        // correct Unicode if the underlying bytes were UTF-8.
        const recovered = decodeURIComponent(escape(decoded));
        // if recovery produced CJK characters, prefer it
        if (/[\u4e00-\u9fff]/.test(recovered)) return recovered;
        // otherwise, if recovered looks safer (fewer high-latin), use it
        const recoveredHasHighLatin = /[\u00C0-\u00FF]/.test(recovered);
        if (!recoveredHasHighLatin) return recovered;
      } catch (ee) {
        // fall through to return decoded
      }
    }
    return decoded;
  } catch (e) {
    return p;
  }
}

let currentPdf = null;
let currentRel = null;
let currentZoom = 0.65; // default smaller (65%)
let currentContainer = null;
let totalPages = 0;
let currentPageIndex = 1;
// navigation history stacks (simple scrollTop-based snapshots)
const navBackStack = [];
const navForwardStack = [];

function updateNavButtons() {
  const back = document.getElementById('nav-back');
  const forward = document.getElementById('nav-forward');
  if (back) back.disabled = navBackStack.length === 0;
  if (forward) forward.disabled = navForwardStack.length === 0;
}

function pushHistorySnapshot(snap) {
  if (!currentContainer && !snap) return;
  try {
    let toPush = snap;
    if (!toPush) {
      toPush = { type: 'scroll', rel: currentRel, scrollTop: currentContainer ? (currentContainer.scrollTop || 0) : 0, page: currentPageIndex || 1 };
    }
    // avoid pushing duplicate consecutive snapshots
    const last = navBackStack.length ? navBackStack[navBackStack.length - 1] : null;
    const snapEqual = (a, b) => {
      if (!a || !b) return false;
      if (a.type !== b.type) return false;
      if (a.type === 'scroll') {
        if ((a.rel || '') !== (b.rel || '')) return false;
        const d = Math.abs((a.scrollTop || 0) - (b.scrollTop || 0));
        return d <= 6; // within a few pixels -> same
      }
      if (a.type === 'pdfpos') {
        if ((a.rel || '') !== (b.rel || '')) return false;
        if ((a.page || 0) !== (b.page || 0)) return false;
        const lx = Number(a.pdfLeft || 0), rx = Number(b.pdfLeft || 0);
        const ly = Number(a.pdfTop || 0), ry = Number(b.pdfTop || 0);
        const zd = Math.abs((Number(a.zoom || 0) - Number(b.zoom || 0)));
        return Math.abs(lx - rx) <= 2 && Math.abs(ly - ry) <= 2 && zd <= 0.01;
      }
      return false;
    };
    if (last && snapEqual(last, toPush)) {
      // skip duplicate
    } else {
      navBackStack.push(toPush);
    }
    navForwardStack.length = 0;
    updateNavButtons();
  } catch (e) {}
}

async function goToSnapshot(snap, direction) {
  if (!snap) return;
  const contentEl = document.getElementById('content');
  // hide content during snapshot restore to avoid visible jumps
  let prevVisibility = null;
  if (contentEl) { prevVisibility = contentEl.style.visibility; contentEl.style.visibility = 'hidden'; }
  try {
    const curSnap = { rel: currentRel, scrollTop: currentContainer ? currentContainer.scrollTop || 0 : 0, page: currentPageIndex || 1 };
    if (direction === 'back') navForwardStack.push(curSnap);
    else if (direction === 'forward') navBackStack.push(curSnap);
    updateNavButtons();
    if (snap.rel && snap.rel !== currentRel) {
        // if the snapshot contains precise PDF coordinates, pass them into openFile
        // so renderPdf can position before making the document visible.
        if (snap.type === 'pdfpos') {
          const initial = { page: snap.page, pdfLeft: snap.pdfLeft, pdfTop: snap.pdfTop, zoom: snap.zoom };
          await openFile(snap.rel, initial);
          await new Promise(r => setTimeout(r, 120));
          try { await scrollToPagePosition(currentPdf, snap.page, snap.pdfLeft, snap.pdfTop, snap.zoom, false, false); } catch (e) {}
        } else {
          // for scroll snapshots, open file and restore scrollTop without smooth behavior
          const initial = { page: snap.page };
          await openFile(snap.rel, initial);
          await new Promise(r => setTimeout(r, 80));
          try { if (currentContainer) currentContainer.scrollTop = snap.scrollTop || 0; } catch (e) {}
        }
    } else {
        if (snap.type === 'pdfpos') {
          try { await scrollToPagePosition(currentPdf, snap.page, snap.pdfLeft, snap.pdfTop, snap.zoom, false, false); } catch (e) {}
        } else {
          try { if (currentContainer) currentContainer.scrollTop = snap.scrollTop || 0; } catch (e) {}
        }
    }
  } catch (e) { console.warn('goToSnapshot failed', e); }
  finally {
    if (contentEl) { contentEl.style.visibility = prevVisibility || ''; }
  }
}

// Resolve a relative PDF path against a base path (handles base that is a filename)
function resolveRelativePath(base, rel) {
  if (!rel) return rel;
  if (/^[a-zA-Z]+:\/\//.test(rel)) return rel; // absolute URL
  if (rel.startsWith('/')) return rel.replace(/^\//, '');
  const b = (base || '').replace(/\\/g, '/');
  const dir = b.includes('/') ? b.replace(/\/[^/]*$/, '') : '';
  const parts = (dir ? dir + '/' + rel : rel).split('/');
  const out = [];
  for (const p of parts) {
    if (p === '.' || p === '') continue;
    if (p === '..') { out.pop(); continue; }
    out.push(p);
  }
  return out.join('/');
}

function updatePageUI() {
  const disp = document.getElementById('page-display');
  if (disp) disp.textContent = (currentPageIndex || 0) + ' / ' + (totalPages || 0);
  const prevBtn = document.getElementById('page-prev');
  const nextBtn = document.getElementById('page-next');
  if (prevBtn) prevBtn.disabled = currentPageIndex <= 1;
  if (nextBtn) nextBtn.disabled = currentPageIndex >= totalPages;
}

function scrollToPage(index, recordHistory = true, smooth = true) {
  if (!currentContainer) return;
  const pages = Array.from(currentContainer.querySelectorAll('.pdf-page'));
  index = Math.max(1, Math.min(totalPages, index));
  const el = pages[index - 1];
  if (!el) return;
  // record current place before navigating (allow caller to suppress)
  if (recordHistory !== false) pushHistorySnapshot();
  // account for any fixed header at the top of the viewer so the target
  // page isn't hidden beneath it
  const headerH = (document.querySelector('#viewer .viewer-header') && document.querySelector('#viewer .viewer-header').clientHeight) || 0;
  const target = Math.max(0, el.offsetTop - headerH - 8);
  currentContainer.scrollTo({ top: target, behavior: smooth ? 'smooth' : 'auto' });
}

function detectCurrentPage() {
  if (!currentContainer) return;
  const pages = Array.from(currentContainer.querySelectorAll('.pdf-page'));
  const mid = currentContainer.scrollTop + currentContainer.clientHeight / 2;
  let found = 1;
  for (let i = 0; i < pages.length; i++) {
    const top = pages[i].offsetTop;
    const bottom = top + pages[i].clientHeight;
    if (mid >= top && mid <= bottom) {
      found = i + 1;
      break;
    }
    if (mid < top) { found = i + 1; break; }
  }
  currentPageIndex = Math.max(1, Math.min(totalPages, found));
  updatePageUI();
}

async function renderPdf(pdf, zoomVal, initialScroll) {
  const content = document.getElementById('content');
  content.innerHTML = '';
  const container = document.createElement('div');
  container.className = 'pdf-container';
  // build hidden to avoid showing the top-of-document while we render
  container.style.visibility = 'hidden';
  content.appendChild(container);

  // compute available width based on outer content area to keep consistent across pages
  const contentEl = document.getElementById('content');
  const availableWidth = Math.max(400, contentEl.clientWidth - 24);
  // measure canonical (collapsed) available width so zoom percent maps to the
  // same physical size regardless of sidebar state. We briefly ensure the
  // document has the `collapsed` class when measuring so the width matches
  // the collapsed layout. Do not persist changes to the class here.
  let collapsedAvailableWidth = availableWidth;
  try {
    const doc = document.documentElement;
    const wasCollapsed = doc.classList.contains('collapsed');
    if (!wasCollapsed) doc.classList.add('collapsed');
    // re-read width under collapsed layout
    collapsedAvailableWidth = Math.max(400, contentEl.clientWidth - 24);
    if (!wasCollapsed) doc.classList.remove('collapsed');
  } catch (e) {
    // fallback to current availableWidth if measurement fails
    collapsedAvailableWidth = availableWidth;
  }
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const unscaledViewport = page.getViewport({ scale: 1 });
    // base scale to fit canonical (collapsed) width then apply zoomVal multiplier
    // this makes `zoomVal` produce the same visual result whether sidebar is
    // collapsed or expanded (we choose collapsed as the canonical reference).
    let baseScale = collapsedAvailableWidth / unscaledViewport.width;
    baseScale = Math.min(2.5, Math.max(0.4, baseScale));
    baseScale = baseScale * zoomVal;
    // device pixel ratio for high-DPI rendering (cap to avoid huge bitmaps)
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const displayViewport = page.getViewport({ scale: baseScale });

    const canvasWrap = document.createElement('div');
    canvasWrap.className = 'pdf-page';
    const canvas = document.createElement('canvas');
    canvas.className = 'pdf-canvas';
    // backing store size multiplied by dpr for crispness
    canvas.width = Math.floor(displayViewport.width * dpr);
    canvas.height = Math.floor(displayViewport.height * dpr);
    // CSS size remains at display size
    canvas.style.width = Math.floor(displayViewport.width) + 'px';
    canvas.style.height = Math.floor(displayViewport.height) + 'px';

    canvasWrap.appendChild(canvas);
    container.appendChild(canvasWrap);

    const ctx = canvas.getContext('2d');
    // render using a viewport scaled by devicePixelRatio so pixels map 1:1
    const displayScale = baseScale;
    const effectiveDpr = Math.min(dpr, 3);
    const renderViewport = page.getViewport({ scale: displayScale * effectiveDpr });
    // ensure backing store matches renderViewport
    canvas.width = Math.floor(renderViewport.width);
    canvas.height = Math.floor(renderViewport.height);
    // keep CSS size at display size (use displayScale which may include extraScale)
    const displayViewportScaled = page.getViewport({ scale: displayScale });
    canvas.style.width = Math.floor(displayViewportScaled.width) + 'px';
    canvas.style.height = Math.floor(displayViewportScaled.height) + 'px';
    // disable image smoothing to keep text sharp when downscaled
    if (ctx.imageSmoothingEnabled !== undefined) ctx.imageSmoothingEnabled = false;
    if (ctx.imageSmoothingQuality !== undefined) ctx.imageSmoothingQuality = 'high';
    await page.render({ canvasContext: ctx, viewport: renderViewport }).promise;
    // create annotation overlay for this page (capture links and make them clickable)
    try {
      canvasWrap.style.position = 'relative';
      const annotations = await page.getAnnotations();
      const annotationLayer = document.createElement('div');
      annotationLayer.className = 'annotationLayer';
      annotationLayer.style.position = 'absolute';
      // align overlay to the rendered canvas using canvas offset within the page wrapper
      const canvasClientWidth = Math.floor(canvas.clientWidth || displayViewportScaled.width);
      const canvasClientHeight = Math.floor(canvas.clientHeight || displayViewportScaled.height);
      const canvasLeftOffset = canvas.offsetLeft || Math.floor((canvasWrap.clientWidth - canvasClientWidth) / 2);
      const canvasTopOffset = canvas.offsetTop || 0;
      annotationLayer.style.left = canvasLeftOffset + 'px';
      annotationLayer.style.top = canvasTopOffset + 'px';
      annotationLayer.style.width = canvasClientWidth + 'px';
      annotationLayer.style.height = canvasClientHeight + 'px';
      annotationLayer.style.pointerEvents = 'auto';
      annotationLayer.style.zIndex = 20;
      canvasWrap.appendChild(annotationLayer);

      const pageCssWidth = canvasClientWidth;
      const pageCssHeight = canvasClientHeight;

      // helper: use top-level resolver to handle base filenames correctly
      const resolveRelative = resolveRelativePath;

      annotations.forEach((annot, idx) => {
        if (annot.subtype !== 'Link') return;
        try {
          // compute viewport rectangle using unscaled viewport first (works reliably)
          const unscaled = page.getViewport({ scale: 1 });
          let r = null;
          try {
            if (typeof unscaled.convertToViewportRectangle === 'function') {
              r = unscaled.convertToViewportRectangle(annot.rect);
            }
          } catch (e) {
            r = null;
          }
          if (!r) {
            const rect = annot.rect;
            const scale = canvas.clientWidth / unscaled.width;
            r = [rect[0] * scale, rect[1] * scale, rect[2] * scale, rect[3] * scale];
          }

          const a = document.createElement('a');
          a.style.position = 'absolute';
          // store rect for later recompute on resize/zoom
          try { a.dataset.rect = JSON.stringify(annot.rect); } catch (e) { a.dataset.rect = ''; }
          a.dataset.annontype = annot.subtype || '';
          // compute CSS using helper
          try {
            const css = computeAnchorCss(page, annot.rect, canvas);
            if (css) {
              a.style.left = css.left;
              a.style.top = css.top;
              a.style.width = css.width;
              a.style.height = css.height;
            }
          } catch (e) {}
          a.style.display = 'block';
          a.style.background = 'transparent';
          a.style.pointerEvents = 'auto';
          a.href = '#';
          a.title = annot.title || '';

          // link target candidates
          const targetUrl = annot.url || annot.unsafeUrl || (annot.action && (annot.action.uri || annot.action.url)) || null;
          const dest = annot.dest || (annot.action && annot.action.dest) || null;

          // attach meta + visible border for debugging
          a.dataset.target = targetUrl || '';
          a.dataset.unsafe = targetUrl || '';
          a.dataset.dest = (typeof dest === 'string') ? dest : (dest ? JSON.stringify(dest) : '');
          a.style.border = '1px solid rgba(11,95,255,0.28)';

          // click behavior
          if (targetUrl) {
            const isHttp = /^https?:\/\//i.test(targetUrl);
            const lower = (targetUrl || '').toLowerCase();
            const containsPdf = lower.includes('.pdf');
            if (!isHttp && containsPdf) {
              a.addEventListener('click', async (e) => {
                e.preventDefault();
                const parts = targetUrl.split('#');
                const rawRel = parts[0];
                const frag = parts[1] || '';
                const rel = safeDecodePath(rawRel);
                const resolved = resolveRelative(currentRel, rel);
                try {
                  // build initial scroll descriptor from fragment so openFile/renderPdf
                  // can position the document before it's visible
                  let initial = null;
                  const m = frag.match(/page=(\d+)/i);
                  if (m) {
                    initial = { page: parseInt(m[1], 10) };
                  } else {
                    const n = frag.match(/nameddest=([^&]+)/i);
                    if (n && n[1]) {
                      initial = { nameddest: decodeURIComponent(n[1]) };
                    } else {
                      const xyz = frag.match(/xyz=([^,]+),([^,]+)(?:,([^&]+))?/i);
                      if (xyz) {
                        const left = parseFloat(xyz[1]);
                        const top = parseFloat(xyz[2]);
                        const zoom = xyz[3] ? parseFloat(xyz[3]) : undefined;
                        initial = { page: 1, pdfLeft: left, pdfTop: top, zoom: zoom };
                      } else {
                        const xy = frag.match(/xy=([^,]+),([^&]+)/i);
                        if (xy) {
                          const left = parseFloat(xy[1]);
                          const top = parseFloat(xy[2]);
                          initial = { page: 1, pdfLeft: left, pdfTop: top };
                        }
                      }
                    }
                  }
                  try { pushHistorySnapshot(); } catch (e) {}
                  await openFile(resolved, initial);
                } catch (e) { console.warn('openFile for annotation failed', e); }
              });
            } else {
              a.href = targetUrl;
              a.target = '_blank';
              a.rel = 'noopener';
            }
          } else if (dest) {
            a.addEventListener('click', async (e) => {
              e.preventDefault();
              try {
                // support dest arrays and named destinations with detailed view
                await scrollToDestination(pdf, dest);
              } catch (e) { }
            });
          }

          annotationLayer.appendChild(a);
        } catch (e) {
          console.error('annotation processing error', { page: pageNum, idx, err: (e && e.stack) || e });
        }
      });
    } catch (e) {
      // ignore annotation layer failures
    }
  }
  // after rendering all pages
  // ensure annotation anchors are attached after all pages rendered
  try {
    await attachAnnotations(pdf, container);
  } catch (e) {
    console.warn('attachAnnotations failed', e);
  }
  currentContainer = container;
  totalPages = pdf.numPages;
  currentPageIndex = 1;
  updatePageUI();
  // If an initial scroll target was provided, perform an immediate, non-smooth jump
  // while the container is still hidden to avoid showing the document top.
  if (initialScroll) {
    try {
      // named destination: resolve and delegate to scrollToDestination
      if (initialScroll.nameddest) {
        try {
          const destArr = await pdf.getDestination(initialScroll.nameddest);
          if (destArr) await scrollToDestination(pdf, destArr, false, false);
        } catch (e) {}
      } else if (initialScroll.page) {
        const pageIndex = Math.max(1, Math.min(pdf.numPages, Number(initialScroll.page) || 1));
        const pages = Array.from(container.querySelectorAll('.pdf-page'));
        const pageWrap = pages[pageIndex - 1];
        if (pageWrap) {
          const canvas = pageWrap.querySelector('canvas');
          if (canvas) {
            try {
              const page = await pdf.getPage(pageIndex);
              const unscaled = page.getViewport({ scale: 1 });
              const scale = canvas.clientWidth / unscaled.width;
              const x = (typeof initialScroll.pdfLeft === 'number') ? (initialScroll.pdfLeft * scale) : 0;
              const y = (typeof initialScroll.pdfTop === 'number') ? (initialScroll.pdfTop * scale) : 0;
              const cssTop = canvas.clientHeight - y;
              const headerH = (document.querySelector('#viewer .viewer-header') && document.querySelector('#viewer .viewer-header').clientHeight) || 0;
              const target = pageWrap.offsetTop + cssTop - headerH - 8;
              currentContainer.scrollTop = Math.max(0, target);
            } catch (e) {}
          }
        }
      }
    } catch (e) {}
  }
  // now show the rendered document
  container.style.visibility = '';
  // scroll listener to update current page
  let t = 0;
  container.addEventListener('scroll', () => {
    if (t) clearTimeout(t);
    t = setTimeout(() => detectCurrentPage(), 80);
  });
}

// After rendering pages, attach annotation anchors robustly (separate pass)
async function attachAnnotations(pdf, container) {
  if (!pdf || !container) return;
  const pages = Array.from(container.querySelectorAll('.pdf-page'));
  for (let i = 1; i <= pdf.numPages; i++) {
    try {
      const page = await pdf.getPage(i);
      const ann = await page.getAnnotations();
      if (!ann || ann.length === 0) continue;
      const pageWrap = pages[i - 1];
      if (!pageWrap) continue;
      const canvas = pageWrap.querySelector('canvas');
      if (!canvas) continue;
      let layer = pageWrap.querySelector('.annotationLayer');
      if (!layer) {
        layer = document.createElement('div');
        layer.className = 'annotationLayer';
        layer.style.position = 'absolute';
        layer.style.left = (canvas.offsetLeft || 0) + 'px';
        layer.style.top = (canvas.offsetTop || 0) + 'px';
        layer.style.width = canvas.clientWidth + 'px';
        layer.style.height = canvas.clientHeight + 'px';
        layer.style.pointerEvents = 'auto';
        layer.style.zIndex = 20;
        pageWrap.appendChild(layer);
      }

      const unscaled = page.getViewport({ scale: 1 });
      const scale = canvas.clientWidth / unscaled.width;

      // helper: compare rects (string stored in dataset vs rect array)
      const rectsEqual = (rectStr, rectArr) => {
        try {
          if (!rectStr) return false;
          const a = JSON.parse(rectStr);
          if (!Array.isArray(a) || !Array.isArray(rectArr) || a.length !== rectArr.length) return false;
          for (let i = 0; i < a.length; i++) {
            const v1 = Number(a[i]);
            const v2 = Number(rectArr[i]);
            if (isNaN(v1) || isNaN(v2)) return false;
            if (Math.abs(v1 - v2) > 0.5) return false; // allow small rounding diffs
          }
          return true;
        } catch (e) { return false; }
      };

      ann.forEach((a, idx) => {
        if (a.subtype !== 'Link') return;
        try {
          const rect = a.rect;
          const r = [rect[0] * scale, rect[1] * scale, rect[2] * scale, rect[3] * scale];
          const x1 = Math.min(r[0], r[2]);
          const x2 = Math.max(r[0], r[2]);
          const y1 = Math.min(r[1], r[3]);
          const y2 = Math.max(r[1], r[3]);
          const w = x2 - x1;
          const h = y2 - y1;
          const top = canvas.clientHeight - y2;

          const el = document.createElement('a');
          el.style.position = 'absolute';
          el.style.left = x1 + 'px';
          el.style.top = top + 'px';
          el.style.width = w + 'px';
          el.style.height = h + 'px';
          el.style.display = 'block';
          el.style.background = 'transparent';
          el.style.pointerEvents = 'auto';
          el.style.border = '1px solid rgba(11,95,255,0.28)';
          el.dataset.unsafe = a.unsafeUrl || '';

          const targetUrl = a.url || a.unsafeUrl || (a.action && (a.action.uri || a.action.url)) || null;
          const dest = a.dest || (a.action && a.action.dest) || null;

          // avoid creating duplicate anchors when renderPdf already created them
          const existingAnchors = Array.from(layer.querySelectorAll('a'));
          const unsafeMatch = a.unsafeUrl || a.url || (a.action && (a.action.uri || a.action.url)) || '';
          const destMatch = (typeof dest === 'string') ? dest : (dest ? JSON.stringify(dest) : '');
          // If an existing anchor matches target+dest AND its rect is effectively
          // the same, treat it as the same link and update; otherwise allow a
          // separate anchor so multiple links to the same file at different
          // positions are all visible.
          const found = existingAnchors.find(ex => {
            const exUnsafe = (ex.dataset && ex.dataset.unsafe) || '';
            const exDest = (ex.dataset && ex.dataset.dest) || '';
            if (exUnsafe !== unsafeMatch || exDest !== destMatch) return false;
            // if both have rects and they're equal (within tolerance), consider duplicate
            const exRect = (ex.dataset && ex.dataset.rect) || '';
            return rectsEqual(exRect, a.rect || rect || []);
          });
          if (found) {
            try { found.dataset.rect = JSON.stringify(a.rect || rect || []); } catch (e) {}
            try {
              const css = computeAnchorCss(page, a.rect || rect, canvas);
              if (css) {
                found.style.left = css.left; found.style.top = css.top; found.style.width = css.width; found.style.height = css.height;
              }
            } catch (e) {}
            return;
          }

          if (targetUrl) {
            const isHttp = /^https?:\/\//i.test(targetUrl);
            const lower = (targetUrl || '').toLowerCase();
            const containsPdf = lower.includes('.pdf');
              if (!isHttp && containsPdf) {
              el.href = '#';
              el.addEventListener('click', async (e) => {
                e.preventDefault();
                const parts = targetUrl.split('#');
                const rel = parts[0];
                const frag = parts[1] || '';
                  const resolved = resolveRelativePath(currentRel, safeDecodePath(rel));
                try {
                  // build initial scroll descriptor from fragment
                  let initial = null;
                  const m = frag.match(/page=(\d+)/i);
                  if (m) {
                    initial = { page: parseInt(m[1], 10) };
                  } else {
                    const n = frag.match(/nameddest=([^&]+)/i);
                    if (n && n[1]) {
                      initial = { nameddest: decodeURIComponent(n[1]) };
                    } else {
                      const xyz = frag.match(/xyz=([^,]+),([^,]+)(?:,([^&]+))?/i);
                      if (xyz) {
                        const left = parseFloat(xyz[1]);
                        const top = parseFloat(xyz[2]);
                        const zoom = xyz[3] ? parseFloat(xyz[3]) : undefined;
                        initial = { page: 1, pdfLeft: left, pdfTop: top, zoom: zoom };
                      } else {
                        const xy = frag.match(/xy=([^,]+),([^&]+)/i);
                        if (xy) {
                          const left = parseFloat(xy[1]);
                          const top = parseFloat(xy[2]);
                          initial = { page: 1, pdfLeft: left, pdfTop: top };
                        }
                      }
                    }
                  }
                  try { pushHistorySnapshot(); } catch (e) {}
                  await openFile(resolved, initial);
                } catch (e) { console.warn('attachAnnotations openFile failed', e); }
              });
            } else {
              el.href = targetUrl;
              el.target = '_blank';
              el.rel = 'noopener';
            }
          } else if (dest) {
            el.href = '#';
            el.addEventListener('click', async (e) => {
              e.preventDefault();
              try {
                  if (typeof dest === 'string') {
                  const destArr = await pdf.getDestination(dest);
                  if (!destArr) return;
                  const ref = destArr[0];
                  const idx = await pdf.getPageIndex(ref);
                  scrollToPage(idx + 1, true, false);
                } else if (Array.isArray(dest)) {
                  const ref = dest[0];
                  const idx = await pdf.getPageIndex(ref);
                  scrollToPage(idx + 1, true, false);
                }
              } catch (e) { console.warn('attachAnnotations dest handler failed', e); }
            });
          }

          layer.appendChild(el);
        } catch (e) {
          console.warn('attachAnnotations: failed to create anchor', e);
        }
      });
    } catch (e) {
      console.warn('attachAnnotations page error', e);
    }
  }
}

// Update annotationLayer positions to follow canvas when layout changes
function updateAnnotationLayerPositions() {
  const pages = Array.from(document.querySelectorAll('.pdf-page'));
  pages.forEach(pageWrap => {
    const canvas = pageWrap.querySelector('canvas');
    const layer = pageWrap.querySelector('.annotationLayer');
    if (!canvas || !layer) return;
    const left = canvas.offsetLeft || 0;
    const top = canvas.offsetTop || 0;
    layer.style.left = left + 'px';
    layer.style.top = top + 'px';
    layer.style.width = canvas.clientWidth + 'px';
    layer.style.height = canvas.clientHeight + 'px';
    // recompute anchor positions inside this layer based on stored rects
    const anchors = Array.from(layer.querySelectorAll('a'));
    anchors.forEach(a => {
      try {
        const rectStr = a.dataset && a.dataset.rect;
        if (!rectStr) return;
        const rect = JSON.parse(rectStr);
        // determine page index for this layer
        const pagesAll = Array.from(document.querySelectorAll('.pdf-page'));
        const pageIndex = pagesAll.indexOf(pageWrap) + 1;
        if (pageIndex <= 0) return;
        // get pdf page object if available
        if (!currentPdf) return;
        currentPdf.getPage(pageIndex).then(p => {
          const css = computeAnchorCss(p, rect, canvas);
          if (css) {
            a.style.left = css.left; a.style.top = css.top; a.style.width = css.width; a.style.height = css.height;
          }
        }).catch(() => {});
      } catch (e) {}
    });
  });
}

// compute CSS position for an annotation rect relative to a canvas
function computeAnchorCss(page, rect, canvas) {
  // rect is PDF coordinates [x1,y1,x2,y2]
  if (!rect || !canvas || !page) return null;
  const unscaled = page.getViewport({ scale: 1 });
  const scale = canvas.clientWidth / unscaled.width;
  const r = [rect[0] * scale, rect[1] * scale, rect[2] * scale, rect[3] * scale];
  const x1 = Math.min(r[0], r[2]);
  const x2 = Math.max(r[0], r[2]);
  const y1 = Math.min(r[1], r[3]);
  const y2 = Math.max(r[1], r[3]);
  const w = x2 - x1;
  const h = y2 - y1;
  const cssTop = canvas.clientHeight - y2;
  return { left: Math.round(x1) + 'px', top: Math.round(cssTop) + 'px', width: Math.round(w) + 'px', height: Math.round(h) + 'px' };
}

// Scroll to a specific position on a page (left, top are PDF-space coordinates)
async function scrollToPagePosition(pdf, pageIndex, pdfLeft, pdfTop, optZoom, recordHistory = true, smooth = true) {
  if (!pdf || !currentContainer) return;
  pageIndex = Math.max(1, Math.min(pdf.numPages, pageIndex));

  // if an explicit zoom is requested, re-render at that zoom then scroll
  if (optZoom && Math.abs(optZoom - currentZoom) > 0.001) {
    currentZoom = optZoom;
    await renderPdf(pdf, currentZoom);
  }

  const pages = Array.from(currentContainer.querySelectorAll('.pdf-page'));
  const pageWrap = pages[pageIndex - 1];
  if (!pageWrap) return;
  const canvas = pageWrap.querySelector('canvas');
  if (!canvas) return;

  try {
    const page = await pdf.getPage(pageIndex);
    const unscaled = page.getViewport({ scale: 1 });
    const scale = canvas.clientWidth / unscaled.width;
    // pdfTop is distance from left/bottom in PDF coordinates; convert to CSS pixels
    const x = (typeof pdfLeft === 'number') ? (pdfLeft * scale) : 0;
    const y = (typeof pdfTop === 'number') ? (pdfTop * scale) : 0;
    const cssTop = canvas.clientHeight - y;
    // record current place before navigating (allow caller to suppress)
    if (recordHistory !== false) {
      // save precise PDF-space target so history can restore exact location
      pushHistorySnapshot({ type: 'pdfpos', rel: currentRel, page: pageIndex, pdfLeft: pdfLeft, pdfTop: pdfTop, zoom: optZoom });
    }
    const headerH = (document.querySelector('#viewer .viewer-header') && document.querySelector('#viewer .viewer-header').clientHeight) || 0;
    const target = pageWrap.offsetTop + cssTop - headerH - 8;
    currentContainer.scrollTo({ top: Math.max(0, target), behavior: smooth ? 'smooth' : 'auto' });
  } catch (e) {
    console.warn('scrollToPagePosition failed', e);
  }
}

// Accepts PDF destination arrays or strings and performs a detailed scroll
async function scrollToDestination(pdf, dest, recordHistory = true, smooth = true) {
  if (!pdf || !dest) return;
  try {
    // dest can be an array like [ref, "XYZ", left, top, zoom]
    if (Array.isArray(dest)) {
      const ref = dest[0];
      const view = dest[1];
      const pageIndex = await pdf.getPageIndex(ref) + 1;
      if (!view) { // no view -> go to page
        return scrollToPage(pageIndex, recordHistory, smooth);
      }
      const type = (typeof view === 'string') ? view : (view && view.name) || String(view);
      if (/XYZ/i.test(type)) {
        const left = (dest.length > 2 && typeof dest[2] === 'number') ? dest[2] : null;
        const top = (dest.length > 3 && typeof dest[3] === 'number') ? dest[3] : null;
        const zoom = (dest.length > 4 && typeof dest[4] === 'number') ? dest[4] : null;
        return scrollToPagePosition(pdf, pageIndex, left, top, zoom || undefined, recordHistory, smooth);
      }
      // other view types (FitH, FitV, FitR) -> just scroll to page for now
      return scrollToPage(pageIndex, recordHistory, smooth);
    } else if (typeof dest === 'string') {
      // named destination string: resolve via pdf.getDestination
      const destArr = await pdf.getDestination(dest);
      if (destArr) return scrollToDestination(pdf, destArr, recordHistory, smooth);
    }
  } catch (e) { console.warn('scrollToDestination failed', e); }
}

async function openFile(relPath, initialScroll) {
  // ensure relPath is decoded once (handles percent-encoded filenames coming
  // from annotation targets) before further processing and before we
  // re-encode it for the `/file?path=` request.
  const decodedRel = safeDecodePath(relPath);
  const lower = (decodedRel || '').toLowerCase();
  const content = document.getElementById('content');
  if (lower.endsWith('.pdf')) {
    // If caller provided an initialScroll target, avoid showing the loading
    // placeholder so we don't flash the top of the document before positioning.
    if (initialScroll) content.innerHTML = '';
    else content.innerHTML = '<div class="loading">正在加载 PDF…</div>';
    const url = '/file?path=' + encodeURIComponent(decodedRel);
    try {
      await ensurePdfJs();
      const loadingTask = pdfjsLib.getDocument({ url });
      const pdf = await loadingTask.promise;
      currentPdf = pdf;
      currentRel = relPath;
      // if caller requested an initial zoom, apply it so renderPdf can use it
      if (initialScroll && typeof initialScroll.zoom === 'number') {
        currentZoom = initialScroll.zoom;
      }
      // update viewer title to the file name
      try {
        const titleTextEl = document.getElementById('viewer-title-text');
        const titleEl = document.querySelector('#viewer .title');
        const parts = relPath.split('/');
        let name = parts[parts.length - 1] || relPath;
        try { name = decodeURIComponent(name); } catch (e) {}
        name = name.replace(/\.pdf$/i, '');
        // remove leading two-digit prefix and following space used for sorting
        name = name.replace(/^[0-9]{2}\s+/, '');
        if (titleTextEl) titleTextEl.textContent = name;
        else if (titleEl) titleEl.textContent = name;
      } catch (e) {}
      // sync left tree selection to the opened file, expanding ancestor dirs if needed
      revealAndSelectTreePath(relPath).catch(() => {});
      await renderPdf(pdf, currentZoom, initialScroll);
      // update nav buttons after opening a file
      updateNavButtons();
    } catch (e) {
      content.innerHTML = '<div class="error">无法加载 PDF：' + (e && e.message) + '</div>';
    }
  } else {
    content.innerHTML = '<div class="msg">非 PDF 文件，无法预览。</div>';
  }
}

async function init() {
  const tree = document.getElementById('tree');
  try {
    const root = await apiList('');
    // render root items
    root.items.forEach(it => {
      const node = createNode(it);
      tree.appendChild(node);
    });
    // clicking empty area in tree or sidebar deselects any selected item and clears parent highlights
    tree.addEventListener('click', (e) => {
      const label = e.target.closest && e.target.closest('.label');
      if (!label) {
        document.querySelectorAll('.label.selected').forEach(el => el.classList.remove('selected'));
        document.querySelectorAll('.label.selected-parent').forEach(el => el.classList.remove('selected-parent'));
      }
    });
    // also listen on the whole sidebar so clicks in the lower blank area (below last item)
    // also clear selection
    const sidebarEl = document.getElementById('sidebar');
    if (sidebarEl) {
      sidebarEl.addEventListener('click', (e) => {
        const label = e.target.closest && e.target.closest('.label');
        if (!label) {
          document.querySelectorAll('.label.selected').forEach(el => el.classList.remove('selected'));
          document.querySelectorAll('.label.selected-parent').forEach(el => el.classList.remove('selected-parent'));
        }
      });
    }
    // bind Escape to clear selection as well
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' || e.key === 'Esc') {
        document.querySelectorAll('.label.selected').forEach(el => el.classList.remove('selected'));
        document.querySelectorAll('.label.selected-parent').forEach(el => el.classList.remove('selected-parent'));
      }
    });
    // wire zoom controls
    const zin = document.getElementById('zoom-in');
    const zout = document.getElementById('zoom-out');
    const zval = document.getElementById('zoom-value');
    const pprev = document.getElementById('page-prev');
    const pnext = document.getElementById('page-next');
    const pdisp = document.getElementById('page-display');
    const updateDisplay = () => { zval.textContent = Math.round(currentZoom * 100) + '%'; };
    updateDisplay();
    zin.addEventListener('click', async () => {
      currentZoom = Math.min(2.5, +(currentZoom + 0.05).toFixed(2));
      updateDisplay();
      if (currentPdf) await renderPdf(currentPdf, currentZoom);
    });
    zout.addEventListener('click', async () => {
      currentZoom = Math.max(0.5, +(currentZoom - 0.05).toFixed(2));
      updateDisplay();
      if (currentPdf) await renderPdf(currentPdf, currentZoom);
    });
    // zoom-fit button removed
    pprev.addEventListener('click', () => { scrollToPage(currentPageIndex - 1); });
    pnext.addEventListener('click', () => { scrollToPage(currentPageIndex + 1); });
    pdisp.addEventListener('click', async () => {
      const s = prompt('跳转到第几页（1 - ' + totalPages + '）', String(currentPageIndex));
      const n = parseInt(s, 10);
      if (!isNaN(n)) scrollToPage(n);
    });

    // sidebar toggle
    const toggleBtn = document.getElementById('toggle-sidebar');
    const appEl = document.getElementById('app');
    const applyState = (collapsed) => {
      if (collapsed) document.documentElement.classList.add('collapsed');
      else document.documentElement.classList.remove('collapsed');
      // expanded -> show left triangle; collapsed -> show right triangle
      if (toggleBtn) toggleBtn.textContent = collapsed ? '▶' : '◀';
    };
    // restore from localStorage
    const saved = localStorage.getItem('sidebarCollapsed') === '1';
    applyState(saved);
    if (toggleBtn) toggleBtn.addEventListener('click', () => {
      const isCollapsed = document.documentElement.classList.toggle('collapsed');
      localStorage.setItem('sidebarCollapsed', isCollapsed ? '1' : '0');
      applyState(isCollapsed);
      // do NOT change the PDF scroll position when toggling sidebar;
      // only re-align annotation overlays after layout change.
      setTimeout(updateAnnotationLayerPositions, 60);
    });
    // update positions on window resize as well
    window.addEventListener('resize', () => setTimeout(updateAnnotationLayerPositions, 40));
    // wire nav back/forward buttons
    const backBtn = document.getElementById('nav-back');
    const forwardBtn = document.getElementById('nav-forward');
    if (backBtn) backBtn.addEventListener('click', async () => {
      if (navBackStack.length === 0) return;
      const snap = navBackStack.pop();
      await goToSnapshot(snap, 'back');
      updateNavButtons();
    });
    if (forwardBtn) forwardBtn.addEventListener('click', async () => {
      if (navForwardStack.length === 0) return;
      const snap = navForwardStack.pop();
      await goToSnapshot(snap, 'forward');
      updateNavButtons();
    });
    updateNavButtons();
  } catch (e) {
    tree.innerHTML = '<div class="error">无法读取根目录。请在启动服务器时指定 `--root` 参数。</div>';
  }
}

init();
