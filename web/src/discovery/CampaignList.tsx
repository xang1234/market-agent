import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import type { Campaign } from "../../../services/discovery/src/types.ts";
import { PRIMARY_BUTTON_CLASS, SECONDARY_BUTTON_CLASS } from "../shell/buttonStyles.ts";
import { useAuth } from "../shell/useAuth.ts";
import { EmptyState } from "../ui/EmptyState.tsx";
import { PageHeader } from "../ui/PageHeader.tsx";
import {
  FIELD_CLASS,
  FIELD_LABEL_CLASS,
  PAGE_CLASS,
  PAGE_PANEL_CLASS,
  PANEL_TITLE_CLASS,
} from "../ui/pageStyles.ts";
import { createCampaign, discoveryMessage, listCampaigns } from "./api.ts";

export function CampaignList() {
  const { session } = useAuth();
  const userId = session?.userId ?? null;
  const navigate = useNavigate();
  // loadFailed: the first page never arrived, so an empty list means unknown, not none.
  const [campaignState, setCampaignState] = useState<{ userId: string; campaigns: Campaign[]; nextCursor: string | null; loadingMore: boolean; loadFailed: boolean } | null>(null);
  const [name, setName] = useState("");
  const [question, setQuestion] = useState("");
  const [error, setError] = useState<{ userId: string; scope: "list" | "create"; message: string } | null>(null);
  const [creating, setCreating] = useState(false);
  const scopedCampaignState = campaignState?.userId === userId ? campaignState : null;
  const campaigns = scopedCampaignState?.campaigns ?? [];
  const nextCursor = scopedCampaignState?.nextCursor ?? null;
  const loadingMore = scopedCampaignState?.loadingMore ?? false;
  const knownEmpty = scopedCampaignState !== null && !scopedCampaignState.loadFailed && campaigns.length === 0;
  const scopedError = error?.userId === userId ? error : null;
  const listError = scopedError?.scope === "list" ? <EmptyState tone="error">{scopedError.message}</EmptyState> : null;

  useEffect(() => {
    if (!userId) return;
    let active = true;
    listCampaigns({ userId }).then((page) => { if (active) setCampaignState({ userId, campaigns: page.items, nextCursor: page.next_cursor, loadingMore: false, loadFailed: false }); }).catch((caught) => {
      if (active) {
        setCampaignState({ userId, campaigns: [], nextCursor: null, loadingMore: false, loadFailed: true });
        setError({ userId, scope: "list", message: discoveryMessage(caught, "Campaigns could not be loaded.") });
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
        loadFailed: false,
      } : current);
    } catch (caught) {
      setError({ userId: actionUserId, scope: "list", message: discoveryMessage(caught, "More campaigns could not be loaded.") });
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
      setError({ userId, scope: "create", message: discoveryMessage(caught, "The campaign could not be created.") });
    } finally {
      setCreating(false);
    }
  }

  const header = (
    <PageHeader
      title="Research campaigns"
      description="Start with a question, then review and approve the research brief."
    />
  );

  if (!userId) {
    return (
      <div className={PAGE_CLASS}>
        {header}
        <EmptyState>Sign in to create research campaigns.</EmptyState>
      </div>
    );
  }

  return (
    <div className={PAGE_CLASS}>
      {header}
      <div className="flex w-full max-w-2xl flex-col gap-6">
        <form onSubmit={submit} className={`flex flex-col gap-4 ${PAGE_PANEL_CLASS}`}>
          <h2 className={PANEL_TITLE_CLASS}>New campaign</h2>
          <label className={FIELD_LABEL_CLASS}>
            Campaign name
            <input
              aria-label="Campaign name"
              value={name}
              onInput={(event) => setName(event.currentTarget.value)}
              required
              className={FIELD_CLASS}
            />
          </label>
          <label className={FIELD_LABEL_CLASS}>
            Research question
            <textarea
              aria-label="Research question"
              value={question}
              onInput={(event) => setQuestion(event.currentTarget.value)}
              required
              minLength={20}
              rows={3}
              className={FIELD_CLASS}
            />
          </label>
          <div className="flex flex-wrap items-center justify-end gap-3">
            {scopedError?.scope === "create" ? <p role="alert" className="mr-auto text-sm text-negative">{scopedError.message}</p> : null}
            <button type="submit" disabled={creating} className={`${PRIMARY_BUTTON_CLASS} disabled:opacity-60`}>
              {creating ? "Creating campaign…" : "Create campaign"}
            </button>
          </div>
        </form>
        <section aria-labelledby="campaign-list-heading" className="flex flex-col gap-3">
          <h2 id="campaign-list-heading" className={PANEL_TITLE_CLASS}>Your campaigns</h2>
          {campaigns.length > 0 ? (
            <>
              <ul className="grid gap-2">
                {campaigns.map((campaign) => (
                  <li key={campaign.campaign_id}>
                    <Link
                      to={`/discovery/${encodeURIComponent(campaign.campaign_id)}`}
                      className={`block ${PAGE_PANEL_CLASS} transition-colors hover:border-accent-border`}
                    >
                      <span className="font-medium text-fg">{campaign.name}</span>
                      <span className="mt-1 block text-sm text-muted">{campaign.question}</span>
                    </Link>
                  </li>
                ))}
              </ul>
              {nextCursor ? (
                <button
                  type="button"
                  onClick={() => { void loadMore(); }}
                  disabled={loadingMore}
                  className={`w-fit ${SECONDARY_BUTTON_CLASS}`}
                >
                  {loadingMore ? "Loading more campaigns…" : "Load more campaigns"}
                </button>
              ) : null}
              {listError}
            </>
          ) : knownEmpty ? (
            <EmptyState>No campaigns yet. Create one to begin.</EmptyState>
          ) : listError}
        </section>
      </div>
    </div>
  );
}

function mergeCampaigns(current: Campaign[], more: Campaign[]): Campaign[] {
  return [...new Map([...current, ...more].map((campaign) => [campaign.campaign_id, campaign])).values()];
}
