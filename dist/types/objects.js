// Type guards
export function isBlob(obj) {
    return obj.type === 'blob';
}
export function isTree(obj) {
    return obj.type === 'tree';
}
export function isCommit(obj) {
    return obj.type === 'commit';
}
export function isTag(obj) {
    return obj.type === 'tag';
}
// Helper functions
const encoder = new TextEncoder();
const decoder = new TextDecoder();
function hexToBytes(hex) {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
        bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
    }
    return bytes;
}
function bytesToHex(bytes) {
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}
function formatAuthor(prefix, author) {
    return `${prefix} ${author.name} <${author.email}> ${author.timestamp} ${author.timezone}`;
}
function parseAuthorLine(line) {
    // Format: "author Name <email> timestamp timezone"
    // or "committer Name <email> timestamp timezone"
    // or "tagger Name <email> timestamp timezone"
    const match = line.match(/^(?:author|committer|tagger) (.+) <(.+)> (\d+) ([+-]\d{4})$/);
    if (!match) {
        throw new Error(`Invalid author line: ${line}`);
    }
    return {
        name: match[1],
        email: match[2],
        timestamp: parseInt(match[3], 10),
        timezone: match[4]
    };
}
// Serialization
export function serializeBlob(data) {
    // Git format: "blob <size>\0<content>"
    const header = encoder.encode(`blob ${data.length}\0`);
    const result = new Uint8Array(header.length + data.length);
    result.set(header);
    result.set(data, header.length);
    return result;
}
export function serializeTree(entries) {
    // Git format: "tree <size>\0<entries>"
    // Each entry: "<mode> <name>\0<20-byte-sha>"
    // Sort entries by name (Git sorts directories as if they have trailing /)
    const sortedEntries = [...entries].sort((a, b) => {
        const aName = a.mode === '040000' ? a.name + '/' : a.name;
        const bName = b.mode === '040000' ? b.name + '/' : b.name;
        return aName.localeCompare(bName);
    });
    // Build entry content
    const entryParts = [];
    for (const entry of sortedEntries) {
        const modeName = encoder.encode(`${entry.mode} ${entry.name}\0`);
        const sha20 = hexToBytes(entry.sha);
        const entryData = new Uint8Array(modeName.length + 20);
        entryData.set(modeName);
        entryData.set(sha20, modeName.length);
        entryParts.push(entryData);
    }
    // Calculate total content length
    const contentLength = entryParts.reduce((sum, part) => sum + part.length, 0);
    const content = new Uint8Array(contentLength);
    let offset = 0;
    for (const part of entryParts) {
        content.set(part, offset);
        offset += part.length;
    }
    // Add header
    const header = encoder.encode(`tree ${contentLength}\0`);
    const result = new Uint8Array(header.length + contentLength);
    result.set(header);
    result.set(content, header.length);
    return result;
}
export function serializeCommit(commit) {
    // Git format: "commit <size>\0<content>"
    // Content:
    // tree <sha>\n
    // parent <sha>\n (for each parent)
    // author <name> <email> <timestamp> <timezone>\n
    // committer <name> <email> <timestamp> <timezone>\n
    // \n
    // <message>
    const lines = [];
    lines.push(`tree ${commit.tree}`);
    for (const parent of commit.parents) {
        lines.push(`parent ${parent}`);
    }
    lines.push(formatAuthor('author', commit.author));
    lines.push(formatAuthor('committer', commit.committer));
    lines.push('');
    lines.push(commit.message);
    const content = lines.join('\n');
    const header = `commit ${encoder.encode(content).length}\0`;
    return encoder.encode(header + content);
}
export function serializeTag(tag) {
    // Git format: "tag <size>\0<content>"
    // Content:
    // object <sha>\n
    // type <objecttype>\n
    // tag <name>\n
    // tagger <name> <email> <timestamp> <timezone>\n
    // \n
    // <message>
    const lines = [];
    lines.push(`object ${tag.object}`);
    lines.push(`type ${tag.objectType}`);
    lines.push(`tag ${tag.name}`);
    if (tag.tagger) {
        lines.push(formatAuthor('tagger', tag.tagger));
    }
    lines.push('');
    lines.push(tag.message);
    const content = lines.join('\n');
    const header = `tag ${encoder.encode(content).length}\0`;
    return encoder.encode(header + content);
}
// Deserialization
export function parseBlob(data) {
    // Git format: "blob <size>\0<content>"
    // Find the null byte to separate header from content
    const nullIndex = data.indexOf(0);
    if (nullIndex === -1) {
        throw new Error('Invalid blob: no null byte found');
    }
    const header = decoder.decode(data.slice(0, nullIndex));
    const match = header.match(/^blob (\d+)$/);
    if (!match) {
        throw new Error(`Invalid blob header: ${header}`);
    }
    const content = data.slice(nullIndex + 1);
    return {
        type: 'blob',
        data: content
    };
}
export function parseTree(data) {
    // Git format: "tree <size>\0<entries>"
    // Each entry: "<mode> <name>\0<20-byte-sha>"
    const nullIndex = data.indexOf(0);
    if (nullIndex === -1) {
        throw new Error('Invalid tree: no null byte found');
    }
    const header = decoder.decode(data.slice(0, nullIndex));
    const match = header.match(/^tree (\d+)$/);
    if (!match) {
        throw new Error(`Invalid tree header: ${header}`);
    }
    const entries = [];
    let offset = nullIndex + 1;
    while (offset < data.length) {
        // Find the null byte after mode+name
        let entryNullIndex = offset;
        while (entryNullIndex < data.length && data[entryNullIndex] !== 0) {
            entryNullIndex++;
        }
        const modeNameStr = decoder.decode(data.slice(offset, entryNullIndex));
        const spaceIndex = modeNameStr.indexOf(' ');
        const mode = modeNameStr.slice(0, spaceIndex);
        const name = modeNameStr.slice(spaceIndex + 1);
        // Read 20-byte SHA
        const sha20 = data.slice(entryNullIndex + 1, entryNullIndex + 21);
        const sha = bytesToHex(sha20);
        entries.push({ mode, name, sha });
        offset = entryNullIndex + 21;
    }
    return {
        type: 'tree',
        data: data.slice(nullIndex + 1),
        entries
    };
}
export function parseCommit(data) {
    // Git format: "commit <size>\0<content>"
    const nullIndex = data.indexOf(0);
    if (nullIndex === -1) {
        throw new Error('Invalid commit: no null byte found');
    }
    const header = decoder.decode(data.slice(0, nullIndex));
    const match = header.match(/^commit (\d+)$/);
    if (!match) {
        throw new Error(`Invalid commit header: ${header}`);
    }
    const content = decoder.decode(data.slice(nullIndex + 1));
    const lines = content.split('\n');
    let tree = '';
    const parents = [];
    let author = null;
    let committer = null;
    let messageStartIndex = 0;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line === '') {
            // Empty line separates headers from message
            messageStartIndex = i + 1;
            break;
        }
        if (line.startsWith('tree ')) {
            tree = line.slice(5);
        }
        else if (line.startsWith('parent ')) {
            parents.push(line.slice(7));
        }
        else if (line.startsWith('author ')) {
            author = parseAuthorLine(line);
        }
        else if (line.startsWith('committer ')) {
            committer = parseAuthorLine(line);
        }
    }
    if (!author || !committer) {
        throw new Error('Invalid commit: missing author or committer');
    }
    const message = lines.slice(messageStartIndex).join('\n');
    return {
        type: 'commit',
        data: data.slice(nullIndex + 1),
        tree,
        parents,
        author,
        committer,
        message
    };
}
export function parseTag(data) {
    // Git format: "tag <size>\0<content>"
    const nullIndex = data.indexOf(0);
    if (nullIndex === -1) {
        throw new Error('Invalid tag: no null byte found');
    }
    const header = decoder.decode(data.slice(0, nullIndex));
    const match = header.match(/^tag (\d+)$/);
    if (!match) {
        throw new Error(`Invalid tag header: ${header}`);
    }
    const content = decoder.decode(data.slice(nullIndex + 1));
    const lines = content.split('\n');
    let object = '';
    let objectType = 'commit';
    let name = '';
    let tagger = null;
    let messageStartIndex = 0;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line === '') {
            // Empty line separates headers from message
            messageStartIndex = i + 1;
            break;
        }
        if (line.startsWith('object ')) {
            object = line.slice(7);
        }
        else if (line.startsWith('type ')) {
            objectType = line.slice(5);
        }
        else if (line.startsWith('tag ')) {
            name = line.slice(4);
        }
        else if (line.startsWith('tagger ')) {
            tagger = parseAuthorLine(line);
        }
    }
    if (!tagger) {
        throw new Error('Invalid tag: missing tagger');
    }
    const message = lines.slice(messageStartIndex).join('\n');
    return {
        type: 'tag',
        data: data.slice(nullIndex + 1),
        object,
        objectType,
        name,
        tagger,
        message
    };
}
//# sourceMappingURL=objects.js.map