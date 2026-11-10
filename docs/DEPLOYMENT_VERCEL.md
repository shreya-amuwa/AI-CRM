# Vercel production deployments: "Deployment was blocked"

> The CRM is moving to Cloudflare Workers: see `DEPLOYMENT_CLOUDFLARE.md`. This page applies only while Vercel is still in use.

## What happens

The CRM deploys to Vercel from `main` (project `ai-crm`, team "AI CRM", Hobby plan). Vercel checks the **Git author of the commit it
deploys**. When that author is a GitHub account that Vercel does not link to the team, the deployment stops before building and GitHub shows:

> Vercel - Deployment was blocked
> Git author shreya-amuwa must have access to the project on Vercel to create deployments.

This is not a build or code error: the same code builds as a Preview with status Ready. It happened on 6 Nov 2026 to the merge of
pull request #179 (commit `88b81ed`), whose merge commit GitHub authors as `shreya-amuwa`. The Candidate Recruitment Portal project of the
same Vercel team was blocked at the same moment for the same reason.

## Permanent fix (Vercel settings, once)

1. Sign in to Vercel with the account that owns the "AI CRM" team.
2. Account Settings -> Authentication: connect the GitHub account `shreya-amuwa` (disconnect a different GitHub account if one is connected).
   A Hobby team cannot invite members, so the GitHub account must belong to that same Vercel account.
3. Deployments -> the blocked deployment -> "..." -> Redeploy (for each blocked project).

After this, every merge deploys by itself, whatever merge button is used.

## Until the fix is made

Merge pull requests with **Rebase and merge** (the arrow next to the merge button on GitHub). The commits then reach `main` with their own
authors, and the commit Vercel deploys is not authored by `shreya-amuwa`. "Create a merge commit" makes a new commit authored by the person
who clicks the button (and "Squash and merge" can too), which Vercel blocks while that account is not linked.

A deployment already blocked does not restart by itself: use Redeploy in Vercel, or merge the next pull request with Rebase and merge.
