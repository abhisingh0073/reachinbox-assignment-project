
import "dotenv/config";
import { Client } from "@elastic/elasticsearch";

export const elasticsearch = new Client({
  node: process.env.ELASTICSEARCH_URL ?? "http://localhost:9200",
});

const EMAIL_INDEX = "scheduled-emails";
type EmailDocument = {
  id?: string;
  user_id: string;
  recipient: string;
  subject: string;
  body: string;
  sender_id: string;
  status: string;
  scheduled_at: string | Date;
  sent_at?: string | Date | null;
  created_at: string | Date;
  attempts?: number;
};

export async function initializeElasticsearch() {
  try {
    const exists = await elasticsearch.indices.exists({
      index: EMAIL_INDEX,
    });

    if (!exists) {
      await elasticsearch.indices.create({
        index: EMAIL_INDEX,
        mappings: {
          properties: {
            id: { type: "keyword" },
            user_id: { type: "keyword" },
            recipient: { type: "keyword" },
            subject: { type: "text" },
            body: { type: "text" },
            sender_id: { type: "keyword" },
            status: { type: "keyword" },
            scheduled_at: { type: "date" },
            sent_at: { type: "date" },
            created_at: { type: "date" },
            attempts: { type: "integer" },
          },
        },
      });

      console.log("Elasticsearch email index created");
    } else {
      console.log("Elasticsearch email index already exists");
    }
  } catch (error) {
    console.error("Elasticsearch initialization failed:", error);
    throw error;
  }
}

export async function indexEmail(email: {
  id: string;
  user_id: string;
  recipient: string;
  subject: string;
  body: string;
  sender_id: string;
  status: string;
  scheduled_at: Date | string;
  sent_at?: Date | string | null;
  created_at: Date | string;
  attempts?: number;
}) {
  await elasticsearch.index({
    index: EMAIL_INDEX,
    id: email.id,
    document: {
      ...email,
      user_id: email.user_id,
    },
    refresh: "wait_for",
  });
}





export async function searchEmails(
  query: string,
  options: {
    userId: string;
    page: number;
    limit: number;
    status?: string;
  }
) {
  const { userId, page, limit, status } = options;

  const filters = [
    { term: { "user_id.keyword": userId } },
    ...(status ? [{ term: { status } }] : []),
  ];

  const searchQuery = query.trim()
    ? {
        multi_match: {
          query: query.trim(),
          fields: ["recipient", "subject", "body", "sender_id"],
        },
      }
    : { match_all: {} };

  const result = await elasticsearch.search<EmailDocument>({
    index: EMAIL_INDEX,
    from: (page - 1) * limit,
    size: limit,
    track_total_hits: true,
    query: {
      bool: {
        must: [searchQuery],
        filter: filters,
      },
    },
    sort: [{ created_at: { order: "desc" } }],
  });

  const total =
    typeof result.hits.total === "number"
      ? result.hits.total
      : result.hits.total?.value ?? 0;

  const emails = result.hits.hits.flatMap((hit) => {
    const source = hit._source;

    if (!source) return [];

    return [{
      ...source,
      id: hit._id,
      attempts: Number(source.attempts ?? 0),
    }];
  });

  return { emails, total };
}
