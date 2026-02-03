# GitX Deployment Guide

Deploy GitX to Cloudflare Workers for a production-ready Git server.

## Prerequisites

1. **Cloudflare Account** with Workers Paid plan ($5/month minimum for Durable Objects)
2. **Wrangler CLI** installed: `npm install -g wrangler`
3. **Node.js** 18.0.0 or later
4. **pnpm** package manager: `npm install -g pnpm`

## Step 1: Create R2 Buckets

Create three R2 buckets in the Cloudflare dashboard or via CLI:

```bash
# Large git objects (>1MB)
wrangler r2 bucket create gitx-objects

# Legacy packfiles (transitional)
wrangler r2 bucket create gitx-packs

# Parquet storage (primary)
wrangler r2 bucket create gitx-analytics
```

## Step 2: Configure wrangler.toml

The default `wrangler.toml` is pre-configured. Key settings:

```toml
name = "gitx-do"
main = "src/worker.ts"
compatibility_date = "2024-12-18"
compatibility_flags = ["nodejs_compat"]

# Custom domain (optional)
[[routes]]
pattern = "gitx.yourdomain.com"
custom_domain = true

# Durable Objects - uses SQLite-backed class
[durable_objects]
bindings = [
  { name = "GITX", class_name = "GitRepoDOSQL" }
]

# R2 bucket bindings
[[r2_buckets]]
binding = "R2"
bucket_name = "gitx-objects"

[[r2_buckets]]
binding = "PACK_STORAGE"
bucket_name = "gitx-packs"

[[r2_buckets]]
binding = "ANALYTICS_BUCKET"
bucket_name = "gitx-analytics"

# Observability
[observability]
enabled = true
```

### Custom Domain Setup

To use a custom domain:

1. Add the domain to your Cloudflare account
2. Update the `pattern` in `[[routes]]`
3. Set `custom_domain = true`

## Step 3: Set Secrets

```bash
# Required for GitHub webhook integration
wrangler secret put GITHUB_WEBHOOK_SECRET

# Optional: API authentication
wrangler secret put AUTH_TOKEN
wrangler secret put API_KEYS
```

### Authentication Options

- `AUTH_TOKEN`: Single bearer token for all requests
- `API_KEYS`: Comma-separated list of valid API keys

If neither is set, all requests pass through unauthenticated.

## Step 4: Build and Deploy

```bash
# Install dependencies
pnpm install

# Build TypeScript
pnpm build

# Run tests (optional but recommended)
pnpm test

# Deploy to Cloudflare
pnpm deploy
```

For manual deployment:

```bash
wrangler deploy
```

## Step 5: Verify Deployment

### Health Check

```bash
curl https://gitx.yourdomain.com/health
# Expected: {"status":"ok","service":"gitx-do","timestamp":"..."}
```

### Root Endpoint

```bash
curl https://gitx.yourdomain.com/
# Returns service info and available endpoints
```

### Test Git Clone

```bash
# Initialize a test repo first via API, then clone
git clone https://gitx.yourdomain.com/test-namespace/repo.git
```

### Test Git Push

```bash
cd repo
echo "# Test" > README.md
git add README.md
git commit -m "Initial commit"
git push origin main
```

## R2 Lifecycle Policies

Configure lifecycle rules for cost optimization. See `r2-lifecycle-policies.json` for full details.

Recommended rules via Cloudflare dashboard:

| Bucket | Rule | Action |
|--------|------|--------|
| gitx-objects | Abort incomplete multipart | 7 days |
| gitx-packs | Abort incomplete multipart | 7 days |
| gitx-analytics | Abort incomplete multipart | 7 days |

## Environment Variables Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `GITHUB_WEBHOOK_SECRET` | For webhooks | Secret for verifying GitHub webhook signatures |
| `AUTH_TOKEN` | No | Bearer token for API authentication |
| `API_KEYS` | No | Comma-separated API keys |

## Troubleshooting

### "Durable Object not found" Error

Ensure migrations are applied. The `wrangler.toml` includes:

```toml
[[migrations]]
tag = "v1"
new_classes = ["GitRepoDO"]

[[migrations]]
tag = "v2"
new_sqlite_classes = ["GitRepoDOSQL"]
```

If switching from an existing deployment, you may need to delete old DO data or create new namespaces.

### R2 Bucket Access Denied

Verify bucket bindings match actual bucket names:

```bash
wrangler r2 bucket list
```

### Git Push Fails with 401

Set authentication credentials:

```bash
# If AUTH_TOKEN is set
git config http.extraHeader "Authorization: Bearer YOUR_TOKEN"

# Or use credential helper
git config credential.helper store
```

### Large File Upload Timeout

For files >1MB, GitX uses R2 storage mode. Ensure:

1. `R2` binding is correctly configured
2. Bucket exists and has write permissions
3. For very large files, consider Git LFS

### Webhook Signature Verification Failed

1. Verify `GITHUB_WEBHOOK_SECRET` matches the secret in GitHub webhook settings
2. Check the secret was set correctly: `wrangler secret list`

### High Storage Costs

1. Run garbage collection periodically to remove orphaned objects
2. Enable Parquet compaction to reduce file count
3. Review `r2-lifecycle-policies.json` for cleanup rules

## Production Checklist

- [ ] R2 buckets created with appropriate names
- [ ] `GITHUB_WEBHOOK_SECRET` set for webhook integration
- [ ] Authentication configured (`AUTH_TOKEN` or `API_KEYS`) if needed
- [ ] Custom domain configured and DNS propagated
- [ ] Observability enabled in `wrangler.toml`
- [ ] R2 lifecycle policies configured
- [ ] Health endpoint responding
- [ ] Test git clone/push working
