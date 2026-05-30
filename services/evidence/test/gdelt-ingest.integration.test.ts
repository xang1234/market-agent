import test from "node:test";
import assert from "node:assert/strict";

import {
  fetchEvidenceDocumentMetadata,
  searchEvidenceDocuments,
} from "../src/document-research.ts";
import { ingestGdeltArticleDiscoveries } from "../src/gdelt-ingest.ts";
import type { GdeltArticleDiscovery } from "../src/providers/gdelt.ts";
import { MemoryObjectStore } from "../src/object-store.ts";
import {
  bootstrapDatabase,
  connectedClient,
  dockerAvailable,
} from "../../../db/test/docker-pg.ts";

const SUBJECT_ID = "33333333-3333-4333-a333-333333333333";
const HASH = `sha256:${"a".repeat(64)}`;

test(
  "GDELT ingest persists a searchable subject association and metadata-only read surface",
  { skip: !dockerAvailable() },
  async (t) => {
    const { databaseUrl } = await bootstrapDatabase(t, "gdelt-ingest-search");
    const client = await connectedClient(t, databaseUrl);
    const objectStore = new MemoryObjectStore();
    const article = gdeltArticle();

    const first = await ingestGdeltArticleDiscoveries(
      {
        db: client,
        objectStore,
        discoveryClient: {
          async searchArticles() {
            return {
              articles: [article],
              requestUrl: "https://api.gdeltproject.org/api/v2/doc/doc?query=...",
              retrievedAt: "2026-05-30T01:00:00.000Z",
            };
          },
        },
      },
      {
        subject: {
          subjectRef: { kind: "issuer", id: SUBJECT_ID },
          issuerName: "Acme Robotics Holdings",
          aliases: ["Acme Robotics"],
        },
        startDateTime: "2026-05-29T00:00:00Z",
        endDateTime: "2026-05-30T00:00:00Z",
        searchLanguage: "english",
      },
    );
    const second = await ingestGdeltArticleDiscoveries(
      {
        db: client,
        objectStore,
        discoveryClient: {
          async searchArticles() {
            return {
              articles: [article],
              requestUrl: "https://api.gdeltproject.org/api/v2/doc/doc?query=...",
              retrievedAt: "2026-05-30T01:00:00.000Z",
            };
          },
        },
      },
      {
        subject: {
          subjectRef: { kind: "issuer", id: SUBJECT_ID },
          issuerName: "Acme Robotics Holdings",
          aliases: ["Acme Robotics"],
        },
        startDateTime: "2026-05-29T00:00:00Z",
        endDateTime: "2026-05-30T00:00:00Z",
        searchLanguage: "english",
      },
    );

    assert.equal(first.articles[0]?.status, "created");
    assert.equal(second.articles[0]?.status, "already_present");
    assert.match(first.articles[0]!.document.raw_blob_id, /^ephemeral:/);

    const search = await searchEvidenceDocuments(client, {
      subjectRefs: [{ kind: "issuer", id: SUBJECT_ID }],
      domain: "reuters.com",
      kind: "article",
      publishedFrom: "2026-05-29T00:00:00Z",
      publishedTo: "2026-05-30T00:00:00Z",
    });

    assert.equal(search.documents.length, 1);
    assert.equal(search.documents[0]?.canonical_url, "https://reuters.com/markets/acme-robotics");
    assert.equal(search.documents[0]?.storage_policy, "metadata_only");
    assert.equal(search.documents[0]?.raw_available, false);
    assert.doesNotMatch(JSON.stringify(search), /raw_blob_id|raw_text|FULL PUBLISHER ARTICLE BODY/i);

    const fetched = await fetchEvidenceDocumentMetadata(client, {
      documentId: search.documents[0]!.document_id,
    });
    assert.equal(fetched?.source_disclosure?.includes("not a canonical fact source"), true);
    assert.equal(fetched?.canonical_url, "https://reuters.com/markets/acme-robotics");
    assert.doesNotMatch(JSON.stringify(fetched), /raw_blob_id|raw_text|FULL PUBLISHER ARTICLE BODY/i);
  },
);

function gdeltArticle(): GdeltArticleDiscovery {
  return Object.freeze({
    url: "https://reuters.com/markets/acme-robotics",
    title: "Acme Robotics wins order as shares rise",
    seenAt: "2026-05-29T12:30:00.000Z",
    domain: "reuters.com",
    language: "English",
    sourceCountry: "United States",
    snippet: "Acme Robotics Holdings lifted guidance after a large enterprise order.",
    imageUrl: "https://reuters.com/acme.jpg",
    dedupeKey: "https://reuters.com/markets/acme-robotics",
    providerMetadataHash: HASH,
    providerMetadata: Object.freeze({
      fulltext: "FULL PUBLISHER ARTICLE BODY MUST NOT BE ROUTED OR STORED",
    }),
  });
}
