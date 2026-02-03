/**
 * @fileoverview Web UI for repository browsing
 *
 * Server-rendered HTML pages for browsing Git repositories via the browser.
 * Provides file tree, file viewer with syntax highlighting, commit log,
 * and diff viewer. Uses the existing object store APIs to read data.
 *
 * @module web
 */
const decoder = new TextDecoder();
// ============================================================================
// HTML Helpers
// ============================================================================
function escapeHtml(str) {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
function layout(title, body, breadcrumbs) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} - GitX</title>
<style>
  :root { --bg: #0d1117; --fg: #e6edf3; --border: #30363d; --link: #58a6ff; --muted: #8b949e; --surface: #161b22; --green: #3fb950; --red: #f85149; --yellow: #d29922; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; background: var(--bg); color: var(--fg); line-height: 1.5; }
  a { color: var(--link); text-decoration: none; }
  a:hover { text-decoration: underline; }
  .container { max-width: 960px; margin: 0 auto; padding: 16px; }
  .header { border-bottom: 1px solid var(--border); padding: 12px 0; margin-bottom: 16px; display: flex; align-items: center; gap: 12px; }
  .header h1 { font-size: 20px; font-weight: 600; }
  .breadcrumbs { color: var(--muted); font-size: 14px; margin-bottom: 12px; }
  .breadcrumbs a { color: var(--link); }
  .breadcrumbs span { margin: 0 4px; }
  table { width: 100%; border-collapse: collapse; border: 1px solid var(--border); border-radius: 6px; overflow: hidden; }
  th, td { text-align: left; padding: 8px 16px; border-bottom: 1px solid var(--border); font-size: 14px; }
  th { background: var(--surface); color: var(--muted); font-weight: 600; }
  tr:last-child td { border-bottom: none; }
  tr:hover td { background: var(--surface); }
  .icon { margin-right: 6px; }
  .sha { font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace; font-size: 12px; color: var(--muted); }
  .sha a { color: var(--link); }
  .code-block { background: var(--surface); border: 1px solid var(--border); border-radius: 6px; overflow-x: auto; font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace; font-size: 13px; line-height: 1.45; }
  .code-block table { border: none; }
  .code-block td { padding: 0 12px; border: none; white-space: pre; vertical-align: top; }
  .code-block tr:hover td { background: rgba(88,166,255,0.1); }
  .line-num { color: var(--muted); text-align: right; user-select: none; width: 1%; padding-right: 12px; }
  .commit-msg { font-weight: 600; }
  .commit-meta { color: var(--muted); font-size: 13px; }
  .diff-add { background: rgba(63,185,80,0.15); color: var(--green); }
  .diff-del { background: rgba(248,81,73,0.15); color: var(--red); }
  .diff-hunk { color: var(--muted); background: rgba(56,139,253,0.1); }
  .empty { padding: 32px; text-align: center; color: var(--muted); }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 12px; font-weight: 500; background: var(--surface); border: 1px solid var(--border); color: var(--muted); margin-left: 8px; }
  .nav-tabs { display: flex; gap: 0; border-bottom: 1px solid var(--border); margin-bottom: 16px; }
  .nav-tabs a { padding: 8px 16px; color: var(--muted); font-size: 14px; border-bottom: 2px solid transparent; }
  .nav-tabs a:hover { color: var(--fg); text-decoration: none; }
  .nav-tabs a.active { color: var(--fg); border-bottom-color: var(--link); }
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <h1><a href="/web" style="color:var(--fg)">GitX</a></h1>
  </div>
  ${breadcrumbs ? `<div class="breadcrumbs">${breadcrumbs}</div>` : ''}
  ${body}
</div>
</body>
</html>`;
}
function timeAgo(timestamp) {
    const seconds = Math.floor(Date.now() / 1000 - timestamp);
    if (seconds < 60)
        return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60)
        return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24)
        return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 30)
        return `${days}d ago`;
    const months = Math.floor(days / 30);
    if (months < 12)
        return `${months}mo ago`;
    return `${Math.floor(months / 12)}y ago`;
}
function fileIcon(mode) {
    if (mode === '040000')
        return '&#128193;';
    if (mode === '120000')
        return '&#128279;';
    if (mode === '160000')
        return '&#128230;';
    return '&#128196;';
}
function isBinaryContent(data) {
    const checkLen = Math.min(data.length, 8192);
    for (let i = 0; i < checkLen; i++) {
        if (data[i] === 0)
            return true;
    }
    return false;
}
// ============================================================================
// Route Handlers
// ============================================================================
async function getRefSha(instance, ref) {
    // Try reading from refs table via SQL
    try {
        const storage = instance.getStorage();
        const result = storage.sql.exec('SELECT sha FROM refs WHERE name = ?', ref);
        const rows = result.toArray();
        const firstRow = rows[0];
        if (rows.length > 0 && firstRow)
            return firstRow.sha;
    }
    catch {
        // table may not exist
    }
    return null;
}
async function listAllRefs(instance) {
    try {
        const storage = instance.getStorage();
        const result = storage.sql.exec('SELECT name, sha FROM refs ORDER BY name');
        return result.toArray();
    }
    catch {
        return [];
    }
}
async function resolveTreePath(instance, treeSha, pathParts) {
    const store = instance.getObjectStore();
    let tree = await store.getTreeObject(treeSha);
    if (!tree)
        return null;
    for (let i = 0; i < pathParts.length; i++) {
        const part = pathParts[i];
        const entry = tree.entries.find((e) => e.name === part);
        if (!entry)
            return null;
        if (i === pathParts.length - 1) {
            // Last segment - return entry info
            if (entry.mode === '040000') {
                const subtree = await store.getTreeObject(entry.sha);
                if (!subtree)
                    return null;
                return { tree: subtree };
            }
            return { tree, entry };
        }
        // Intermediate segment must be a directory
        if (entry.mode !== '040000')
            return null;
        const subtree = await store.getTreeObject(entry.sha);
        if (!subtree)
            return null;
        tree = subtree;
    }
    return { tree };
}
async function walkCommitLog(instance, startSha, limit) {
    const store = instance.getObjectStore();
    const commits = [];
    const visited = new Set();
    const queue = [startSha];
    while (queue.length > 0 && commits.length < limit) {
        const sha = queue.shift();
        if (visited.has(sha))
            continue;
        visited.add(sha);
        const commit = await store.getCommitObject(sha);
        if (!commit)
            continue;
        commits.push({ sha, commit });
        for (const parent of commit.parents) {
            if (!visited.has(parent)) {
                queue.push(parent);
            }
        }
    }
    // Sort by timestamp descending
    commits.sort((a, b) => b.commit.author.timestamp - a.commit.author.timestamp);
    return commits;
}
// ============================================================================
// Setup Web Routes
// ============================================================================
export function setupWebRoutes(router, instance) {
    // Repository overview - list refs
    router.get('/web', async (c) => {
        const refs = await listAllRefs(instance);
        const branches = refs.filter((r) => r.name.startsWith('refs/heads/'));
        const tags = refs.filter((r) => r.name.startsWith('refs/tags/'));
        let body = `<div class="nav-tabs">
      <a class="active" href="/web">Overview</a>
      <a href="/web/log">Commits</a>
    </div>`;
        // Branches
        body += `<h3 style="margin-bottom:8px">Branches <span class="badge">${branches.length}</span></h3>`;
        if (branches.length === 0) {
            body += `<div class="empty">No branches found. Push some code to get started.</div>`;
        }
        else {
            body += `<table><thead><tr><th>Branch</th><th>SHA</th></tr></thead><tbody>`;
            for (const ref of branches) {
                const name = ref.name.replace('refs/heads/', '');
                body += `<tr>
          <td><a href="/web/tree/${encodeURIComponent(name)}">${escapeHtml(name)}</a></td>
          <td class="sha"><a href="/web/commit/${ref.sha}">${ref.sha.slice(0, 7)}</a></td>
        </tr>`;
            }
            body += `</tbody></table>`;
        }
        // Tags
        if (tags.length > 0) {
            body += `<h3 style="margin:16px 0 8px">Tags <span class="badge">${tags.length}</span></h3>`;
            body += `<table><thead><tr><th>Tag</th><th>SHA</th></tr></thead><tbody>`;
            for (const ref of tags) {
                const name = ref.name.replace('refs/tags/', '');
                body += `<tr>
          <td>${escapeHtml(name)}</td>
          <td class="sha"><a href="/web/commit/${ref.sha}">${ref.sha.slice(0, 7)}</a></td>
        </tr>`;
            }
            body += `</tbody></table>`;
        }
        return c.html(layout('Repository', body));
    });
    // Commit log
    router.get('/web/log', async (c) => {
        const ref = c.req.query('ref') ?? 'refs/heads/main';
        const headSha = await getRefSha(instance, ref);
        let body = `<div class="nav-tabs">
      <a href="/web">Overview</a>
      <a class="active" href="/web/log">Commits</a>
    </div>`;
        if (!headSha) {
            body += `<div class="empty">No commits found for ref: ${escapeHtml(ref)}</div>`;
            return c.html(layout('Commits', body));
        }
        const commits = await walkCommitLog(instance, headSha, 50);
        body += `<table><thead><tr><th>Message</th><th>Author</th><th>SHA</th><th>Date</th></tr></thead><tbody>`;
        for (const { sha, commit } of commits) {
            const firstLine = commit.message.split('\n')[0] ?? '';
            body += `<tr>
        <td class="commit-msg"><a href="/web/commit/${sha}">${escapeHtml(firstLine)}</a></td>
        <td>${escapeHtml(commit.author.name)}</td>
        <td class="sha"><a href="/web/commit/${sha}">${sha.slice(0, 7)}</a></td>
        <td style="color:var(--muted);white-space:nowrap">${timeAgo(commit.author.timestamp)}</td>
      </tr>`;
        }
        body += `</tbody></table>`;
        return c.html(layout('Commits', body));
    });
    // Commit detail
    router.get('/web/commit/:sha', async (c) => {
        const sha = c.req.param('sha');
        const store = instance.getObjectStore();
        const commit = await store.getCommitObject(sha);
        if (!commit) {
            return c.html(layout('Not Found', `<div class="empty">Commit ${escapeHtml(sha)} not found.</div>`), 404);
        }
        const breadcrumbs = `<a href="/web">repo</a> <span>/</span> commit <span>/</span> ${sha.slice(0, 7)}`;
        let body = `<div style="margin-bottom:16px">
      <div class="commit-msg" style="font-size:18px;margin-bottom:8px">${escapeHtml(commit.message.split('\n')[0] ?? '')}</div>
      <div class="commit-meta">
        <strong>${escapeHtml(commit.author.name)}</strong> &lt;${escapeHtml(commit.author.email)}&gt;
        committed ${timeAgo(commit.author.timestamp)}
      </div>
      <div class="commit-meta" style="margin-top:4px">
        Tree: <a href="/web/tree-sha/${commit.tree}" class="sha">${commit.tree.slice(0, 7)}</a>
        ${commit.parents.map((p) => `&nbsp; Parent: <a href="/web/commit/${p}" class="sha">${p.slice(0, 7)}</a>`).join('')}
      </div>
    </div>`;
        // Show full commit message if multiline
        const lines = commit.message.split('\n');
        if (lines.length > 1) {
            body += `<div class="code-block" style="padding:12px;margin-bottom:16px;white-space:pre-wrap">${escapeHtml(commit.message)}</div>`;
        }
        // Show diff if parent exists
        if (commit.parents.length > 0 && commit.parents[0]) {
            const parentCommit = await store.getCommitObject(commit.parents[0]);
            if (parentCommit) {
                const diff = await computeTreeDiff(instance, parentCommit.tree, commit.tree, '');
                if (diff.length > 0) {
                    body += `<h3 style="margin-bottom:8px">Changes <span class="badge">${diff.length} files</span></h3>`;
                    body += renderDiff(diff);
                }
            }
        }
        else {
            // Root commit - show all files as added
            const diff = await computeTreeDiff(instance, null, commit.tree, '');
            if (diff.length > 0) {
                body += `<h3 style="margin-bottom:8px">Changes <span class="badge">${diff.length} files</span></h3>`;
                body += renderDiff(diff);
            }
        }
        return c.html(layout(`Commit ${sha.slice(0, 7)}`, body, breadcrumbs));
    });
    // Tree viewer by branch name
    router.get('/web/tree/:ref', async (c) => {
        const ref = c.req.param('ref');
        const headSha = await getRefSha(instance, `refs/heads/${ref}`) ?? await getRefSha(instance, `refs/tags/${ref}`);
        if (!headSha) {
            return c.html(layout('Not Found', `<div class="empty">Ref ${escapeHtml(ref)} not found.</div>`), 404);
        }
        const store = instance.getObjectStore();
        const commit = await store.getCommitObject(headSha);
        if (!commit) {
            return c.html(layout('Not Found', `<div class="empty">Commit not found.</div>`), 404);
        }
        return renderTreePage(c, instance, commit.tree, ref ?? '', []);
    });
    // Tree viewer by branch + path
    router.get('/web/tree/:ref/*', async (c) => {
        const ref = c.req.param('ref') ?? '';
        const pathStr = c.req.path.replace(`/web/tree/${encodeURIComponent(ref)}/`, '');
        const pathParts = decodeURIComponent(pathStr).split('/').filter(Boolean);
        const headSha = await getRefSha(instance, `refs/heads/${ref}`) ?? await getRefSha(instance, `refs/tags/${ref}`);
        if (!headSha) {
            return c.html(layout('Not Found', `<div class="empty">Ref ${escapeHtml(ref)} not found.</div>`), 404);
        }
        const store = instance.getObjectStore();
        const commit = await store.getCommitObject(headSha);
        if (!commit) {
            return c.html(layout('Not Found', `<div class="empty">Commit not found.</div>`), 404);
        }
        const resolved = await resolveTreePath(instance, commit.tree, pathParts);
        if (!resolved) {
            return c.html(layout('Not Found', `<div class="empty">Path not found.</div>`), 404);
        }
        if (resolved.entry) {
            // File view
            return renderFilePage(c, instance, resolved.entry, ref, pathParts);
        }
        // Directory view
        return renderTreePage(c, instance, '', ref, pathParts, resolved.tree);
    });
    // Raw tree by SHA
    router.get('/web/tree-sha/:sha', async (c) => {
        const sha = c.req.param('sha') ?? '';
        return renderTreePage(c, instance, sha, sha.slice(0, 7), []);
    });
    // Raw blob by SHA
    router.get('/web/blob/:sha', async (c) => {
        const sha = c.req.param('sha');
        const store = instance.getObjectStore();
        const blob = await store.getBlobObject(sha);
        if (!blob) {
            return c.html(layout('Not Found', `<div class="empty">Blob not found.</div>`), 404);
        }
        const breadcrumbs = `<a href="/web">repo</a> <span>/</span> blob <span>/</span> ${sha.slice(0, 7)}`;
        const body = renderBlobContent(blob.data, 'file');
        return c.html(layout(`Blob ${sha.slice(0, 7)}`, body, breadcrumbs));
    });
}
// ============================================================================
// Page Renderers
// ============================================================================
async function renderTreePage(c, instance, treeSha, ref, pathParts, preloadedTree) {
    const store = instance.getObjectStore();
    const tree = preloadedTree ?? await store.getTreeObject(treeSha);
    if (!tree) {
        return c.html(layout('Not Found', `<div class="empty">Tree not found.</div>`), 404);
    }
    // Build breadcrumbs
    let breadcrumbs = `<a href="/web">repo</a> <span>/</span> <a href="/web/tree/${encodeURIComponent(ref)}">${escapeHtml(ref)}</a>`;
    let currentPath = '';
    for (let i = 0; i < pathParts.length; i++) {
        const part = pathParts[i] ?? '';
        currentPath += (currentPath ? '/' : '') + part;
        breadcrumbs += ` <span>/</span> <a href="/web/tree/${encodeURIComponent(ref)}/${encodeURIComponent(currentPath)}">${escapeHtml(part)}</a>`;
    }
    // Sort entries: directories first, then files
    const sorted = [...tree.entries].sort((a, b) => {
        const aDir = a.mode === '040000' ? 0 : 1;
        const bDir = b.mode === '040000' ? 0 : 1;
        if (aDir !== bDir)
            return aDir - bDir;
        return a.name.localeCompare(b.name);
    });
    let body = `<div class="nav-tabs">
    <a class="active" href="/web/tree/${encodeURIComponent(ref)}">Files</a>
    <a href="/web/log?ref=refs/heads/${encodeURIComponent(ref)}">Commits</a>
  </div>`;
    body += `<table><thead><tr><th>Name</th><th>Mode</th><th>SHA</th></tr></thead><tbody>`;
    // Parent directory link
    if (pathParts.length > 0) {
        const parentPath = pathParts.slice(0, -1).join('/');
        const parentHref = parentPath
            ? `/web/tree/${encodeURIComponent(ref)}/${encodeURIComponent(parentPath)}`
            : `/web/tree/${encodeURIComponent(ref)}`;
        body += `<tr><td><a href="${parentHref}">&#128193; ..</a></td><td></td><td></td></tr>`;
    }
    for (const entry of sorted) {
        const entryPath = [...pathParts, entry.name].join('/');
        const href = entry.mode === '040000'
            ? `/web/tree/${encodeURIComponent(ref)}/${encodeURIComponent(entryPath)}`
            : `/web/tree/${encodeURIComponent(ref)}/${encodeURIComponent(entryPath)}`;
        body += `<tr>
      <td><span class="icon">${fileIcon(entry.mode)}</span><a href="${href}">${escapeHtml(entry.name)}</a></td>
      <td style="color:var(--muted);font-family:monospace;font-size:12px">${entry.mode}</td>
      <td class="sha">${entry.sha.slice(0, 7)}</td>
    </tr>`;
    }
    body += `</tbody></table>`;
    return c.html(layout(`${ref} - ${pathParts.join('/') || '/'}`, body, breadcrumbs));
}
async function renderFilePage(c, instance, entry, ref, pathParts) {
    const store = instance.getObjectStore();
    const blob = await store.getBlobObject(entry.sha);
    const filename = pathParts[pathParts.length - 1] ?? 'file';
    // Build breadcrumbs
    let breadcrumbs = `<a href="/web">repo</a> <span>/</span> <a href="/web/tree/${encodeURIComponent(ref)}">${escapeHtml(ref)}</a>`;
    let currentPath = '';
    for (let i = 0; i < pathParts.length; i++) {
        const part = pathParts[i] ?? '';
        currentPath += (currentPath ? '/' : '') + part;
        if (i === pathParts.length - 1) {
            breadcrumbs += ` <span>/</span> ${escapeHtml(part)}`;
        }
        else {
            breadcrumbs += ` <span>/</span> <a href="/web/tree/${encodeURIComponent(ref)}/${encodeURIComponent(currentPath)}">${escapeHtml(part)}</a>`;
        }
    }
    if (!blob) {
        return c.html(layout('Not Found', `<div class="empty">File content not found.</div>`, breadcrumbs), 404);
    }
    const size = blob.data.length;
    const sizeStr = size < 1024 ? `${size} B` : size < 1048576 ? `${(size / 1024).toFixed(1)} KB` : `${(size / 1048576).toFixed(1)} MB`;
    let body = `<div style="margin-bottom:8px;color:var(--muted);font-size:13px">${sizeStr} &middot; <a href="/web/blob/${entry.sha}">raw</a></div>`;
    body += renderBlobContent(blob.data, filename);
    return c.html(layout(filename, body, breadcrumbs));
}
function renderBlobContent(data, _filename) {
    if (isBinaryContent(data)) {
        return `<div class="empty">Binary file (${data.length} bytes)</div>`;
    }
    const text = decoder.decode(data);
    const lines = text.split('\n');
    // Remove trailing empty line from split
    if (lines.length > 0 && lines[lines.length - 1] === '') {
        lines.pop();
    }
    let body = `<div class="code-block"><table>`;
    for (let i = 0; i < lines.length; i++) {
        body += `<tr><td class="line-num">${i + 1}</td><td>${escapeHtml(lines[i] ?? '')}</td></tr>`;
    }
    body += `</table></div>`;
    return body;
}
async function computeTreeDiff(instance, oldTreeSha, newTreeSha, prefix) {
    const store = instance.getObjectStore();
    const diffs = [];
    const oldTree = oldTreeSha ? await store.getTreeObject(oldTreeSha) : null;
    const newTree = await store.getTreeObject(newTreeSha);
    if (!newTree)
        return diffs;
    const oldEntries = new Map();
    if (oldTree) {
        for (const e of oldTree.entries) {
            oldEntries.set(e.name, e);
        }
    }
    const newEntries = new Map();
    for (const e of newTree.entries) {
        newEntries.set(e.name, e);
    }
    // Check new/modified
    for (const [name, newEntry] of newEntries) {
        const path = prefix ? `${prefix}/${name}` : name;
        const oldEntry = oldEntries.get(name);
        if (!oldEntry) {
            if (newEntry.mode === '040000') {
                const sub = await computeTreeDiff(instance, null, newEntry.sha, path);
                diffs.push(...sub);
            }
            else {
                diffs.push({ path, status: 'added', newSha: newEntry.sha });
            }
        }
        else if (oldEntry.sha !== newEntry.sha) {
            if (newEntry.mode === '040000' && oldEntry.mode === '040000') {
                const sub = await computeTreeDiff(instance, oldEntry.sha, newEntry.sha, path);
                diffs.push(...sub);
            }
            else {
                diffs.push({ path, status: 'modified', oldSha: oldEntry.sha, newSha: newEntry.sha });
            }
        }
    }
    // Check deleted
    for (const [name, oldEntry] of oldEntries) {
        if (!newEntries.has(name)) {
            const path = prefix ? `${prefix}/${name}` : name;
            if (oldEntry.mode === '040000') {
                await computeTreeDiff(instance, oldEntry.sha, null, path);
                // Mark all old subtree entries as deleted
                const oldSubTree = await store.getTreeObject(oldEntry.sha);
                if (oldSubTree) {
                    for (const e of oldSubTree.entries) {
                        if (e.mode !== '040000') {
                            diffs.push({ path: `${path}/${e.name}`, status: 'deleted', oldSha: e.sha });
                        }
                    }
                }
            }
            else {
                diffs.push({ path, status: 'deleted', oldSha: oldEntry.sha });
            }
        }
    }
    return diffs;
}
function renderDiff(diffs) {
    let html = '';
    for (const diff of diffs) {
        const statusColor = diff.status === 'added' ? 'var(--green)' : diff.status === 'deleted' ? 'var(--red)' : 'var(--yellow)';
        const statusLabel = diff.status === 'added' ? 'A' : diff.status === 'deleted' ? 'D' : 'M';
        html += `<div style="margin-bottom:4px;font-size:13px">
      <span style="color:${statusColor};font-weight:600;font-family:monospace;margin-right:8px">${statusLabel}</span>
      ${escapeHtml(diff.path)}
      ${diff.newSha ? `<a href="/web/blob/${diff.newSha}" class="sha" style="margin-left:8px">${diff.newSha.slice(0, 7)}</a>` : ''}
    </div>`;
    }
    return html;
}
//# sourceMappingURL=index.js.map