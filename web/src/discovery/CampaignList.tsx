import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import type { Campaign } from "../../../services/discovery/src/types.ts";
import { useAuth } from "../shell/useAuth.ts";
import { createCampaign, discoveryMessage, listCampaigns } from "./api.ts";

export function CampaignList() {
  const { session } = useAuth();
  const userId = session?.userId ?? null;
  const navigate = useNavigate();
  const [campaignState, setCampaignState] = useState<{ userId: string; campaigns: Campaign[]; nextCursor: string | null; loadingMore: boolean } | null>(null);
  const [name, setName] = useState("");
  const [question, setQuestion] = useState("");
  const [error, setError] = useState<{ userId: string; message: string } | null>(null);
  const [creating, setCreating] = useState(false);
  const scopedCampaignState = campaignState?.userId === userId ? campaignState : null;
  const campaigns = scopedCampaignState?.campaigns ?? [];
  const nextCursor = scopedCampaignState?.nextCursor ?? null;
  const loadingMore = scopedCampaignState?.loadingMore ?? false;
  const scopedError = error?.userId === userId ? error.message : null;

  useEffect(() => {
    if (!userId) return;
    let active = true;
    listCampaigns({ userId }).then((page) => { if (active) setCampaignState({ userId, campaigns: page.items, nextCursor: page.next_cursor, loadingMore: false }); }).catch((caught) => {
      if (active) {
        setCampaignState({ userId, campaigns: [], nextCursor: null, loadingMore: false });
        setError({ userId, message: discoveryMessage(caught, "Campaigns could not be loaded.") });
      }
    });
    return () => { active = false; };
  }, [userId]);

  async function loadMore() {
    if (!userId || !scopedCampaignState?.nextCursor || scopedCampaignState.loadingMore) return;
    const actionUserId = userId;
    const cursor = scopedCampaignState.nextCursor;
    setCampaignState((current) => current?.userId === actionUserId ? { ...current, loadingMore: true } : current);
    setError(null);
    try {
      const page = await listCampaigns({ userId: actionUserId, cursor });
      setCampaignState((current) => current?.userId === actionUserId ? {
        userId: actionUserId,
        campaigns: mergeCampaigns(current.campaigns, page.items),
        nextCursor: page.next_cursor,
        loadingMore: false,
      } : current);
    } catch (caught) {
      setError({ userId: actionUserId, message: discoveryMessage(caught, "More campaigns could not be loaded.") });
    } finally {
      setCampaignState((current) => current?.userId === actionUserId ? { ...current, loadingMore: false } : current);
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!userId || creating) return;
    setCreating(true);
    setError(null);
    try {
      const campaign = await createCampaign({ userId, name: name.trim(), question: question.trim() });
      navigate(`/discovery/${encodeURIComponent(campaign.campaign_id)}`);
    } catch (caught) {
      setError({ userId, message: discoveryMessage(caught, "The campaign could not be created.") });
    } finally {
      setCreating(false);
    }
  }

  if (!userId) return <div className="p-4 text-sm text-muted">Sign in to create research campaigns.</div>;
  return <main className="space-y-5 p-4"><header><p className="text-sm text-muted">Discovery</p><h1 className="text-xl font-semibold text-fg">Research campaigns</h1><p className="mt-1 text-sm text-muted">Start with a question, then review and approve the research brief.</p></header><form onSubmit={submit} className="grid max-w-2xl gap-3 rounded-md border border-line bg-surface p-4"><label className="grid gap-1 text-sm text-fg">Campaign name<input aria-label="Campaign name" value={name} onInput={(event) => setName(event.currentTarget.value)} required className="rounded-md border border-line bg-surface-2 px-3 py-2" /></label><label className="grid gap-1 text-sm text-fg">Research question<textarea aria-label="Research question" value={question} onInput={(event) => setQuestion(event.currentTarget.value)} required minLength={20} rows={3} className="rounded-md border border-line bg-surface-2 px-3 py-2" /></label><button type="submit" disabled={creating} className="w-fit rounded-md bg-accent px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">{creating ? "Creating campaign…" : "Create campaign"}</button></form>{scopedError ? <p role="alert" className="text-sm text-negative">{scopedError}</p> : null}<section aria-labelledby="campaign-list-heading"><h2 id="campaign-list-heading" className="text-base font-semibold text-fg">Your campaigns</h2>{campaigns.length ? <><ul className="mt-2 grid gap-2">{campaigns.map((campaign) => <li key={campaign.campaign_id}><Link to={`/discovery/${encodeURIComponent(campaign.campaign_id)}`} className="block rounded-md border border-line p-3 hover:bg-surface-2"><span className="font-medium text-fg">{campaign.name}</span><span className="mt-1 block text-sm text-muted">{campaign.question}</span></Link></li>)}</ul>{nextCursor ? <button type="button" onClick={() => { void loadMore(); }} disabled={loadingMore} className="mt-3 rounded-md border border-line-strong px-3 py-2 text-sm font-medium text-fg disabled:opacity-60">{loadingMore ? "Loading more campaigns…" : "Load more campaigns"}</button> : null}</> : <p className="mt-2 text-sm text-muted">No campaigns yet. Create one to begin.</p>}</section></main>;
}

function mergeCampaigns(current: Campaign[], more: Campaign[]): Campaign[] {
  return [...new Map([...current, ...more].map((campaign) => [campaign.campaign_id, campaign])).values()];
}
