import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import type { Campaign } from "../../../services/discovery/src/types.ts";
import { useAuth } from "../shell/useAuth.ts";
import { createCampaign, discoveryMessage, listCampaigns } from "./api.ts";

export function CampaignList() {
  const { session } = useAuth();
  const userId = session?.userId ?? null;
  const navigate = useNavigate();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [name, setName] = useState("");
  const [question, setQuestion] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!userId) return;
    let active = true;
    listCampaigns({ userId }).then((page) => { if (active) setCampaigns(page.items); }).catch((caught) => { if (active) setError(discoveryMessage(caught, "Campaigns could not be loaded.")); });
    return () => { active = false; };
  }, [userId]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!userId || creating) return;
    setCreating(true);
    setError(null);
    try {
      const campaign = await createCampaign({ userId, name: name.trim(), question: question.trim() });
      navigate(`/discovery/${encodeURIComponent(campaign.campaign_id)}`);
    } catch (caught) {
      setError(discoveryMessage(caught, "The campaign could not be created."));
    } finally {
      setCreating(false);
    }
  }

  if (!userId) return <div className="p-4 text-sm text-muted">Sign in to create research campaigns.</div>;
  return <main className="space-y-5 p-4"><header><p className="text-sm text-muted">Discovery</p><h1 className="text-xl font-semibold text-fg">Research campaigns</h1><p className="mt-1 text-sm text-muted">Start with a question, then review and approve the research brief.</p></header><form onSubmit={submit} className="grid max-w-2xl gap-3 rounded-md border border-line bg-surface p-4"><label className="grid gap-1 text-sm text-fg">Campaign name<input aria-label="Campaign name" value={name} onInput={(event) => setName(event.currentTarget.value)} required className="rounded-md border border-line bg-surface-2 px-3 py-2" /></label><label className="grid gap-1 text-sm text-fg">Research question<textarea aria-label="Research question" value={question} onInput={(event) => setQuestion(event.currentTarget.value)} required minLength={20} rows={3} className="rounded-md border border-line bg-surface-2 px-3 py-2" /></label><button type="submit" disabled={creating} className="w-fit rounded-md bg-accent px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">{creating ? "Creating campaign…" : "Create campaign"}</button></form>{error ? <p role="alert" className="text-sm text-negative">{error}</p> : null}<section aria-labelledby="campaign-list-heading"><h2 id="campaign-list-heading" className="text-base font-semibold text-fg">Your campaigns</h2>{campaigns.length ? <ul className="mt-2 grid gap-2">{campaigns.map((campaign) => <li key={campaign.campaign_id}><Link to={`/discovery/${encodeURIComponent(campaign.campaign_id)}`} className="block rounded-md border border-line p-3 hover:bg-surface-2"><span className="font-medium text-fg">{campaign.name}</span><span className="mt-1 block text-sm text-muted">{campaign.question}</span></Link></li>)}</ul> : <p className="mt-2 text-sm text-muted">No campaigns yet. Create one to begin.</p>}</section></main>;
}
